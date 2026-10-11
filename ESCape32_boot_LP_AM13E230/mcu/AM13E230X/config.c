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

void init(void) {
	SYSCFG_DL_initPower();
	DL_CRCP_reset(CRC);
	DL_CRCP_enablePower(CRC);

	SYSCTL->SOCLOCK.MCLKCFG &= ~SYSCTL_MCLKCFG_USEHSCLK_MASK; // MCLK=SYSOSC (32 MHz)
	while (SYSCTL->SOCLOCK.CLKSTATUS & SYSCTL_CLKSTATUS_HSCLKMUX_MASK);
	DL_SYSCTL_setMCLKDivider(DL_SYSCTL_MCLK_DIV_2_DIV_4); // SemiMCLK=MCLK/2
	SYSCFG_DL_FLASH_init();
	SYSCFG_DL_Pinmux_init();
	SYSCFG_DL_SYSCTL_init();
	SYSCFG_DL_CRCP_init();

#ifdef IO_RXTX
	GPIOA_AFRH = 0x70000000; // A15 (USART2_RX)
#endif
}
