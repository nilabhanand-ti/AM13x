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

#define REVISION 4

#define CMD_PROBE  0
#define CMD_INFO   1
#define CMD_READ   2
#define CMD_WRITE  3
#define CMD_UPDATE 4
#define CMD_SETWRP 5

#define RES_OK    0
#define RES_ERROR 1

void main(void) {
	uint32_t rst = SYSCTL->SOCLOCK.RSTCAUSE & SYSCTL_RSTCAUSE_ID_MASK; // Read-to-clear (lowest level cause, so BOOTRST reads back as BOOTSW)
	if ((rst == SYSCTL_RSTCAUSE_ID_SYSSW || rst == SYSCTL_RSTCAUSE_ID_CPUSW) && (GSC->FPC_WEPROTA0 | GSC->FPC_WEPROTA1 | GSC->FPC_WEPROTB0 | GSC->FPC_WEPROTB1)) { // Reboot with write protection left by application
		SYSCTL->SOCLOCK.RESETLEVEL = SYSCTL_RESETLEVEL_LEVEL_BOOT; // BOOTRST (once: comes back as BOOTSW, which still gets the reboot ACK)
		SYSCTL->SOCLOCK.RESETCMD = SYSCTL_RESETCMD_KEY_VALUE | SYSCTL_RESETCMD_GO_TRUE;
		for (;;);
	}
	SYSCTL->SOCLOCK.SYSTEMCFG = (SYSCTL->SOCLOCK.SYSTEMCFG & ~(SYSCTL_SYSTEMCFG_KEY_MASK | SYSCTL_SYSTEMCFG_FLASHECCRSTDIS_MASK)) | SYSCTL_SYSTEMCFG_KEY_VALUE | SYSCTL_SYSTEMCFG_FLASHECCRSTDIS_FALSE; // Flash DED -> SYSRST (TRM reset value is NMI)
	if (rst == SYSCTL_RSTCAUSE_ID_SYSFLASHECC) wrp_level = -1; // Flash DED (e.g. half-programmed record slot): skip record scan
	else for (const uint32_t *rec = (const uint32_t *)WRP_REC_ADDR; rec < (const uint32_t *)(WRP_REC_ADDR + PAGE_SIZE) && *rec != 0xffffffff; rec += 4) {
		if (rec[0] == WRP_REC_MAGIC && rec[1] == ~rec[2] && rec[1] <= 2) wrp_level = rec[1]; // Last valid slot wins
	}
	init();
#ifdef CRC_SELFTEST
	if (crc32("12345678", 8) != 0x9ae0daaf) for (;;);
#endif
	initio();
	if (rst == SYSCTL_RSTCAUSE_ID_BOOTSW || rst == SYSCTL_RSTCAUSE_ID_SYSSW || rst == SYSCTL_RSTCAUSE_ID_CPUSW) { // Reboot
		sendval(RES_OK); // ACK after reboot
	}
#ifdef FAST_EXIT
	else if (rst != SYSCTL_RSTCAUSE_ID_SYSFLASHECC) goto done; // No fast exit after flash DED (keep command window)
#endif
	for (;;) {
		switch (recvval()) {
			case CMD_PROBE: // Probe bootloader
				sendval(RES_OK);
				break;
			case CMD_INFO: { // Get info
				int mcu = FACTORYREGION->DEVICEID;
				char buf[32] = {REVISION, IO_PIN, mcu, mcu >> 8, mcu >> 16, mcu >> 24};
				senddata(buf, sizeof buf);
				break;
			}
			case CMD_READ: { // Read block
				int num = recvval();
				if (num == -1) goto done;
				int cnt = recvval();
				if (cnt == -1) goto done;
				senddata(_rom_end + (num << 10), (cnt + 1) << 2);
				break;
			}
			case CMD_WRITE: { // Write block
				int num = recvval();
				if (num == -1) goto done;
				char buf[1024];
				int len = recvdata(buf);
				if (len == -1) goto done;
				sendval(write(_rom_end + (num << 10), buf, len) > 0 ? RES_OK : RES_ERROR);
				break;
			}
			case CMD_UPDATE: { // Update bootloader
				char *buf = _ram_end; // Use upper SRAM as buffer
				int pos = 0;
				for (int i = 0, n = (_rom_end - _rom) >> 10; i < n; ++i) {
					int len = recvdata(buf + pos);
					if (len == -1) goto done;
					sendval(RES_OK);
					pos += len;
					if (len < 1024) break; // Last block
				}
				update(_rom, buf, pos);
				sendval(RES_ERROR);
				break;
			}
			case CMD_SETWRP: // Set write protection
				switch (recvval()) {
					case 0x33: // Off
						setwrp(0);
						break;
					case 0x44: // Bootloader
						setwrp(1);
						break;
					case 0x55: // Full
						setwrp(2);
						break;
				}
				sendval(RES_ERROR);
				break;
			default: // Pass control to application
			done:
				if (*(uint16_t *)_rom_end != 0x32ea) break;
				SysTick->CTRL = 0; // Stop I/O peripherals
				TIMG4->GPRCM.RSTCTL = GPTIMER_RSTCTL_KEY_UNLOCK_W | GPTIMER_RSTCTL_RESETSTKYCLR_CLR | GPTIMER_RSTCTL_RESETASSERT_ASSERT;
				UNICOMM0->GPRCM.RSTCTL = UNICOMM_RSTCTL_KEY_UNLOCK_W | UNICOMM_RSTCTL_RESETSTKYCLR_CLR | UNICOMM_RSTCTL_RESETASSERT_ASSERT;
				DL_UART_reset(SIG_UART_UC4_INST);
				DL_GPIO_reset(GPIO1);
				DL_GPIO_reset(GPIO2);
				DL_GPIO_reset(GPIO3);
				if ((unsigned)wrp_level >= 2) { // Apply write protection (cleared by BOOTRST only), full also if level unknown
					GSC->FPC_WEPROTA0 = GSC_FPC_WEPROTA0_WEPROT_PAGE_MASK;
					GSC->FPC_WEPROTB0 = GSC_FPC_WEPROTB0_WEPROT_PAGE_MASK;
					GSC->FPC_WEPROTA1 = GSC_FPC_WEPROTA1_WEPROT_PAGE_MASK;
					GSC->FPC_WEPROTB1 = GSC_FPC_WEPROTB1_WEPROT_PAGE_MASK;
				} else if (wrp_level) GSC->FPC_WEPROTA0 = (1 << ((_rom_end - _rom + PAGE_SIZE - 1) / PAGE_SIZE)) - 1; // Bootloader
				const uint32_t *vec = (const uint32_t *)(_rom_end + PAGE_SIZE); // Entry point
				__asm__ volatile (
					"msr msp, %0\n\t" // Initialize stack pointer
					"bx %1\n\t" // Jump to application
					:: "r" (vec[0]), "r" (vec[1]) : "memory");
				__builtin_unreachable();
		}
	}
}
