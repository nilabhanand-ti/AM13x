/*
** Copyright (C) Arseny Vakhrushev <arseny.vakhrushev@me.com>
**
** This firmware is free software: you can redistribute it and/or modify
** it under the terms of the GNU General Public License as published by
** the Free Software Foundation, either version 3 of the License, or
** (at your option) any later version.
**
** This firmware is distributed in the hope that it will be useful,
** but WITHOUT ANY WARRANTY; without even the implied warranty of
** MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
** GNU General Public License for more details.
**
** You should have received a copy of the GNU General Public License
** along with this firmware. If not, see <http://www.gnu.org/licenses/>.
*/

#include "common.h"

#ifndef FLASH_CR_STRT
#define FLASH_CR_STRT FLASH_CR_START
#endif

int wrp_level; // -1 - unknown (record unreadable after flash DED), 0 - off, 1 - bootloader, 2 - full

static inline __attribute__((__always_inline__)) void flashprep(uint32_t addr) { // Clear status, unprotect sector
	NVMNW->GEN.CMDCTL = NVMNW_CMDCTL_DATAVEREN_ENABLE; // Fail on 0->1 transitions; clear app-left MODESEL/BANKSEL/REGIONSEL/ADDRXLATEOVR/ECCGENOVR/SSERASEDIS
	NVMNW->GEN.CMDTYPE = NVMNW_CMDTYPE_COMMAND_CLEARSTATUS;
	__DSB();
	__ISB();
	NVMNW->GEN.CMDEXEC = NVMNW_CMDEXEC_VAL_EXECUTE;
	__DSB();
	__ISB();
	while (NVMNW->GEN.STATCMD & NVMNW_STATCMD_CMDINPROGRESS_MASK);
	uint32_t sec = (addr >> 11) & 127; // Sector in bank
	uint32_t b = addr < 0x40000 && sec < 32 ? 0 : 1u << (sec >> 3); // TRM 13.7.3.28 model (bank 1: CMDWEPROTB from sector 0)
	if (sec >= 32) b |= 1u << ((sec >> 3) - 4); // DL_FlashCTL_unprotectSector model (needs silicon verification which one applies)
	NVMNW->GEN.CMDWEPROTA = sec < 32 ? ~(1u << sec) : 0xffffffff;
	NVMNW->GEN.CMDWEPROTB = ~b;
}

static inline __attribute__((__always_inline__)) int flashexec(int *res) { // Execute command, wait for completion
	__DSB();
	__ISB();
	NVMNW->GEN.CMDEXEC = NVMNW_CMDEXEC_VAL_EXECUTE;
	__DSB();
	__ISB();
	uint32_t sr;
	while (((sr = NVMNW->GEN.STATCMD) & (NVMNW_STATCMD_CMDDONE_MASK | NVMNW_STATCMD_CMDPASS_MASK | NVMNW_STATCMD_CMDINPROGRESS_MASK)) == NVMNW_STATCMD_CMDINPROGRESS_STATINPROGRESS);
	if (!(sr & NVMNW_STATCMD_FAILWEPROT_MASK)) *res = -1; // Command not rejected by write protection, flash contents may have changed
	return (sr & (NVMNW_STATCMD_CMDDONE_MASK | NVMNW_STATCMD_CMDPASS_MASK)) == (NVMNW_STATCMD_CMDDONE_STATDONE | NVMNW_STATCMD_CMDPASS_STATPASS);
}

uint32_t crc32(const char *buf, int len) {
	uint32_t *val = (uint32_t *)buf;
	len >>= 2;
	DL_CRCP_setSeed32(CRC, CRCP_SEED);
	while (len--) DL_CRCP_feedData32(CRC, *val++);
	return ~DL_CRCP_getResult32(CRC);
}

__attribute__((__noinline__, __section__(".TI.ramfunc")))
int write(char *dst, const char *src, int len) { // 1 - success, 0 - failed before flash was touched, -1 - failed after erase/program started
	uint32_t end = (uint32_t)dst + len;
	if (((uint32_t)dst & 15) || end > WRP_REC_ADDR + PAGE_SIZE || (wrp_level == 2 && end <= WRP_REC_ADDR)) return 0; // Invalid address or write protection (app area writable if level unknown, for recovery)
	int res = 0;
	uint32_t primask = __get_PRIMASK();
	__disable_irq();
	FRI->FRD_INTF_CTRL = 0; // Bypass flash cache
	GSC->FPC_FLSEMREQ = GSC_FPC_FLSEMREQ_REQ_MASK; // Acquire flash semaphore
	for (int i = 0; (GSC->FPC_FLSEMSTAT & (GSC_FPC_FLSEMSTAT_ASSIGNED_MASK | GSC_FPC_FLSEMSTAT_MATCH_MASK)) != (GSC_FPC_FLSEMSTAT_ASSIGNED_MASK | GSC_FPC_FLSEMSTAT_MATCH_MASK);) if (++i == 10000) goto done;
	uint32_t addr = ((uint32_t)dst + PAGE_SIZE - 1) & ~(PAGE_SIZE - 1);
	uint32_t last = ((uint32_t)dst + len - 1) & ~(PAGE_SIZE - 1);
	while (addr <= last) { // Erase pages
#ifdef STM32F0
		FLASH_AR = addr;
		FLASH_CR = FLASH_CR_PER | FLASH_CR_STRT;
#else
		flashprep(addr);
		NVMNW->GEN.CMDTYPE = NVMNW_CMDTYPE_SIZE_SECTOR | NVMNW_CMDTYPE_COMMAND_ERASE;
		NVMNW->GEN.CMDADDR = addr;
#endif
		if (!flashexec(&res)) goto done;
		addr += PAGE_SIZE;
	}
#ifdef STM32F0
	for (int pos = 0; pos < len; pos += 2) { // Write half-words
		*(uint16_t *)(dst + pos) = *(uint16_t *)(src + pos);
		while (FLASH_SR & FLASH_SR_BSY);
	}
#else
	for (int pos = 0; pos < len; pos += 16) { // Write 128-bit words with ECC (tail padded with 0xff)
		uint32_t a = (uint32_t)dst + pos;
		volatile uint32_t *data = &NVMNW->GEN.CMDDATA0;
		flashprep(a);
		NVMNW->GEN.CMDTYPE = NVMNW_CMDTYPE_SIZE_ONEWORD | NVMNW_CMDTYPE_COMMAND_PROGRAM;
		NVMNW->GEN.CMDBYTEN = NVMNW_CMDBYTEN_VAL_MAXIMUM;
		NVMNW->GEN.CMDADDR = a;
		NVMNW->GEN.CMDDATAINDEX = (a >> 4) & 3;
		for (int i = 0; i < 16; i += 4) data[i >> 2] = pos + i < len ? *(uint32_t *)(src + pos + i) : 0xffffffff;
		if (!flashexec(&res)) goto done;
	}
#endif
#ifdef STM32F0
	if (FLASH_SR & (FLASH_SR_PGERR | FLASH_SR_WRPRTERR)) return 0;
#else
	if (NVMNW->GEN.STATCMD & (NVMNW_STATCMD_FAILWEPROT_MASK | NVMNW_STATCMD_FAILVERIFY_MASK | NVMNW_STATCMD_FAILINVDATA_MASK)) goto done;
#endif
	for (int pos = 0; pos < len; pos += 4) { // Check written data
		if (*(uint32_t *)(dst + pos) != *(uint32_t *)(src + pos)) goto done;
	}
	res = 1;
done:
	GSC->FPC_FLSEMCLR = GSC_FPC_FLSEMCLR_CLR_MASK; // Release flash semaphore
	FRI->FRD_INTF_CTRL = FRI_FRD_INTF_CTRL_DLB_EN_MASK | FRI_FRD_INTF_CTRL_CACHE_EN_MASK;
	__DSB();
	__ISB();
	for (int i = 0; i < 9; ++i) __NOP(); // Wait 9 cycles before returning to flash (TRM 13.5.6)
	__set_PRIMASK(primask);
	return res;
}

__attribute__((__noinline__, __section__(".TI.ramfunc")))
void update(char *dst, const char *src, int len) {
	if (wrp_level) return;
	int res = write(dst, src, len);
	if (!res) return; // Nothing erased, safe to return to flash
	for (int i = 0; res <= 0 && i < 3; ++i) res = write(dst, src, len); // Retry from RAM (bootloader may be erased), never return
	SYSCTL->SOCLOCK.RESETLEVEL = SYSCTL_RESETLEVEL_LEVEL_BOOT; // BOOTRST
	SYSCTL->SOCLOCK.RESETCMD = SYSCTL_RESETCMD_KEY_VALUE | SYSCTL_RESETCMD_GO_TRUE;
	for (;;); // Never return
}

void setwrp(int type) { // 0 - off, 1 - bootloader, 2 - full
	const uint32_t *rec = (const uint32_t *)WRP_REC_ADDR; // Find free record slot
	if (wrp_level >= 0) while (rec < (const uint32_t *)(WRP_REC_ADDR + PAGE_SIZE) && *rec != 0xffffffff) rec += 4; // Else erase sector first (record unreadable)
	if (rec == (const uint32_t *)(WRP_REC_ADDR + PAGE_SIZE)) rec = (const uint32_t *)WRP_REC_ADDR; // Start over (sector erased by write())
#ifdef STM32F0
	char opts[6] = {FLASH_OPTION_BYTE_0, FLASH_OPTION_BYTE_1, FLASH_OPTION_BYTE_2, FLASH_OPTION_BYTE_3, 0xff, 0xff};
	if (type == 1) opts[4] = ~((1 << ((_rom_end - _rom + 4095) >> 12)) - 1);
	else if (type == 2) opts[4] = opts[5] = 0;
	FLASH_CR = FLASH_CR_OPTWRE | FLASH_CR_OPTER;
	FLASH_CR = FLASH_CR_OPTWRE | FLASH_CR_OPTER | FLASH_CR_STRT;
	while (FLASH_SR & FLASH_SR_BSY);
	FLASH_CR = FLASH_CR_OPTWRE | FLASH_CR_OPTPG;
	for (int i = 0; i < 6; ++i) {
		FLASH_OPTION_BYTE(i) = opts[i];
		while (FLASH_SR & FLASH_SR_BSY);
	}
	if (FLASH_SR & (FLASH_SR_PGERR | FLASH_SR_WRPRTERR)) return;
#else
	uint32_t slot[3] = {WRP_REC_MAGIC, type, ~type}; // Write-once record slot (padded with 0xff)
	if (write((char *)rec, (const char *)slot, sizeof slot) <= 0) return;
#endif
#ifdef AT32F4
	SCB_AIRCR = SCB_AIRCR_VECTKEY | SCB_AIRCR_SYSRESETREQ;
#else
	SYSCTL->SOCLOCK.RESETLEVEL = SYSCTL_RESETLEVEL_LEVEL_BOOT; // BOOTRST
	SYSCTL->SOCLOCK.RESETCMD = SYSCTL_RESETCMD_KEY_VALUE | SYSCTL_RESETCMD_GO_TRUE;
#endif
	for (;;); // Never return
}
