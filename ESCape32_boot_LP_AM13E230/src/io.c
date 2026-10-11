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

void initio(void) {
#ifdef IO_UC4
	SYSCFG_DL_SIG_UART_UC4_init();
	DL_UART_changeConfig(SIG_UART_UC4_INST);
	DL_UART_setBaudRateDivisor(SIG_UART_UC4_INST, IO_UC4_BRD64 >> 6, IO_UC4_BRD64 & 0x3f); // 52/5 at MCLK 32 MHz (see config.h)
	DL_UART_enableMajorityVoting(SIG_UART_UC4_INST);
	DL_UART_enable(SIG_UART_UC4_INST);
#elif defined IO_PA2
	SYSCFG_DL_SIG_UART_PA26_init();
	UC0_UART->CTL0 = IO_CTL0 | UNICOMMUART_CTL0_RXE_ENABLE;
	UC0_UART->CTL0 = IO_CTL0 | UNICOMMUART_CTL0_RXE_ENABLE | UNICOMMUART_CTL0_ENABLE_ENABLE;
#else
	SYSCFG_DL_SIG_TIMER_init();
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC] = GPTIMER_CCCTL_01_COC_COMPARE;
	TIMG4->COUNTERREGS.OCTL_01[IO_CC] = GPTIMER_OCTL_01_CCPIV_HIGH | GPTIMER_OCTL_01_CCPO_FUNCVAL;
	TIMG4->COUNTERREGS.CCACT_01[IO_CC] = GPTIMER_CCACT_01_LACT_CCP_HIGH;
	TIMG4->COUNTERREGS.IFCTL_01[IO_CC ^ 1] = GPTIMER_IFCTL_01_ISEL_CCPX_INPUT_PAIR | GPTIMER_IFCTL_01_FE_ENABLED | GPTIMER_IFCTL_01_FP__3;
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC ^ 1] = GPTIMER_CCCTL_01_COC_CAPTURE | GPTIMER_CCCTL_01_ZCOND_CC_TRIG_EDGE; // Zero counter on any edge on CCP
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC ^ 1] |= GPTIMER_CCCTL_01_CCOND_CC_TRIG_FALL; // Capture (pair channel) on falling edge on CCP
	TIMG4->COUNTERREGS.CC_01[IO_CC] = IO_CLK_CNT(76800); // Half-bit time
	TIMG4->COUNTERREGS.CTR = 0;
	TIMG4->COUNTERREGS.CTRCTL = GPTIMER_CTRCTL_CVAE_ZEROVAL | (IO_CC ^ 1) << GPTIMER_CTRCTL_CZC_OFS | GPTIMER_CTRCTL_CM_UP | GPTIMER_CTRCTL_REPEAT_REPEAT_1 | GPTIMER_CTRCTL_EN_ENABLED;
#endif
	SYSCFG_DL_SYSTICK_init(); // 500ms I/O timeout
	DL_SYSTICK_enable();
}

#ifdef IO_UC4
int recvbuf(char *buf, int len) {
	SysTick->VAL = 0;
	SysTick->CTRL;
	for (int i = 0; i < len; ++i) {
		while (DL_UART_isRXFIFOEmpty(SIG_UART_UC4_INST)) {
			if (SysTick->CTRL & SysTick_CTRL_COUNTFLAG_Msk) return 0; // Timeout
		}
		uint32_t d = SIG_UART_UC4_INST->uart->RXDATA; // Pop byte with its own error flags
		if (d & (UNICOMMUART_RXDATA_FRMERR_MASK | UNICOMMUART_RXDATA_BRKERR_MASK | UNICOMMUART_RXDATA_NERR_MASK)) { // Data error
			DL_UART_clearInterruptStatus(SIG_UART_UC4_INST, DL_UART_INTERRUPT_FRAMING_ERROR | DL_UART_INTERRUPT_BREAK_ERROR | DL_UART_INTERRUPT_NOISE_ERROR);
			return 0;
		}
		buf[i] = d;
		SysTick->VAL = 0;
	}
	return 1;
}

void sendbuf(const char *buf, int len) {
	for (int i = 0; i < len; ++i) {
		DL_UART_transmitDataBlocking(SIG_UART_UC4_INST, buf[i]); // Push to TX FIFO
	}
	while (DL_UART_isBusy(SIG_UART_UC4_INST)); // Wait for stop bit
}
#elif defined IO_PA2
int recvbuf(char *buf, int len) {
	SysTick->VAL = 0;
	SysTick->CTRL;
	for (int i = 0; i < len; ++i) {
		while (UC0_UART->STAT & UNICOMMUART_STAT_RXFE_MASK) {
			if (SysTick->CTRL & SysTick_CTRL_COUNTFLAG_Msk) return 0; // Timeout
		}
		uint32_t d = UC0_UART->RXDATA; // Pop byte with its own error flags
		if (d & (UNICOMMUART_RXDATA_FRMERR_MASK | UNICOMMUART_RXDATA_BRKERR_MASK | UNICOMMUART_RXDATA_NERR_MASK)) { // Data error
			UC0_UART->CPU_INT.ICLR = UNICOMMUART_ICLR_FRMERR_CLR | UNICOMMUART_ICLR_BRKERR_CLR | UNICOMMUART_ICLR_NERR_CLR;
			return 0;
		}
		buf[i] = d;
		SysTick->VAL = 0;
	}
	return 1;
}

// Simplified PF swap (not the full TRM 17.2.1 order): UC0 is re-enabled with TXE only before PF 9 is connected,
// so the pad sees an idling-high TX; RXE stays off until the pad is back on PF 8 (no echo). PIPU-only step keeps the pull-up.
void sendbuf(const char *buf, int len) {
	UC0_UART->CTL0 = IO_CTL0;
	UC0_UART->CTL0 = IO_CTL0 | UNICOMMUART_CTL0_ENABLE_ENABLE;
	IOMUX->SECCFG.PINCM[IO_PAD] = IOMUX_PINCM_PIPU_ENABLE;
	IOMUX->SECCFG.PINCM[IO_PAD] = IO_PINCM(IO_PF_TX);
	for (int i = 0; i < len; ++i) {
		while (UC0_UART->STAT & UNICOMMUART_STAT_TXFF_MASK);
		UC0_UART->TXDATA = buf[i]; // Push to TX FIFO
	}
	while (UC0_UART->STAT & UNICOMMUART_STAT_BUSY_MASK); // Wait for stop bit
	IOMUX->SECCFG.PINCM[IO_PAD] = IOMUX_PINCM_PIPU_ENABLE;
	IOMUX->SECCFG.PINCM[IO_PAD] = IO_PINCM(IO_PF_RX);
	UC0_UART->CTL0 = IO_CTL0 | UNICOMMUART_CTL0_RXE_ENABLE;
	UC0_UART->CTL0 = IO_CTL0 | UNICOMMUART_CTL0_RXE_ENABLE | UNICOMMUART_CTL0_ENABLE_ENABLE;
}
#else
int recvbuf(char *buf, int len) {
	SysTick->VAL = 0;
	SysTick->CTRL;
	int n = 10, b = 0;
	for (;;) {
		int sr = TIMG4->CPU_INT.RIS;
		if (sr & IO_CCU) { // Half-bit time
			TIMG4->CPU_INT.ICLR = IO_CCU;
			if (n == 10) continue;
			int p = TIM3_IDR; // Signal level
			if (!n++) { // Start bit
				if (p) return 0; // Data error
				b = 0;
				continue;
			}
			if (n < 10) { // Data bit
				b >>= 1;
				if (p) b |= 0x80;
				continue;
			}
			if (!p) return 0; // Data error
			*buf++ = b;
			if (!--len) return 1;
			SysTick->VAL = 0;
		}
		if (sr & IO_CAP) { // Falling edge
			TIMG4->CPU_INT.ICLR = IO_CAP;
			if (n == 10) n = 0;
		}
		if (SysTick->CTRL & SysTick_CTRL_COUNTFLAG_Msk) return 0; // Timeout
	}
}

void sendbuf(const char *buf, int len) {
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC ^ 1] = GPTIMER_CCCTL_01_COC_CAPTURE;
	TIMG4->COUNTERREGS.CCACT_01[IO_CC] = GPTIMER_CCACT_01_LACT_CCP_HIGH; // Preload high level
	TIMG4->COUNTERREGS.CTR = 0; // Restart bit period
	TIMG4->COMMONREGS.CCPD = 1 << IO_CC; // Enable output
	int n = 0, b = 0;
	for (;;) {
		if (!(TIMG4->CPU_INT.RIS & GPTIMER_CPU_INT_RIS_Z_MASK)) continue;
		TIMG4->CPU_INT.ICLR = GPTIMER_CPU_INT_ICLR_Z_CLR;
		if (!len) break;
		int p = -1;
		if (!n++) b = *buf++; // Start bit
		else if (n < 10) { // Data bit
			if (b & 1) p = 0;
			b >>= 1;
		} else { // Stop bit
			n = 0;
			p = 0;
			--len;
		}
		TIMG4->COUNTERREGS.CCACT_01[IO_CC] = p ? GPTIMER_CCACT_01_LACT_CCP_LOW : GPTIMER_CCACT_01_LACT_CCP_HIGH;
	}
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC ^ 1] = GPTIMER_CCCTL_01_COC_CAPTURE | GPTIMER_CCCTL_01_ZCOND_CC_TRIG_EDGE; // Zero counter on any edge on CCP
	TIMG4->COMMONREGS.CCPD = 0;
	TIMG4->COUNTERREGS.CCCTL_01[IO_CC ^ 1] |= GPTIMER_CCCTL_01_CCOND_CC_TRIG_FALL; // Capture (pair channel) on falling edge on CCP
	TIMG4->COUNTERREGS.CC_01[IO_CC] = IO_CLK_CNT(76800); // Half-bit time
	TIMG4->COUNTERREGS.CTR = 0;
}
#endif

int recvval(void) {
	char buf[2];
	return recvbuf(buf, 2) && (buf[0] ^ buf[1]) == 0xff ? buf[0] : -1;
}

void sendval(int val) {
	char buf[2] = {val, ~val};
	sendbuf(buf, 2);
}

int recvdata(char *buf) {
	int cnt = recvval();
	if (cnt == -1) return -1;
	int len = (cnt + 1) << 2;
	uint32_t crc;
	return recvbuf(buf, len) && recvbuf((char *)&crc, 4) && crc32(buf, len) == crc ? len : -1;
}

void senddata(const char *buf, int len) {
	uint32_t crc = crc32(buf, len);
	sendval((len >> 2) - 1);
	sendbuf(buf, len);
	sendbuf((char *)&crc, 4);
}
