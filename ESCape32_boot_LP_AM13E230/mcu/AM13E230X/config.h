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

#pragma once

#define CLK MCLK_FREQ_HZ
#define IO_CLK SEMIMCLK_FREQ_HZ // UC0/TIMG4 BUSCLK = SemiMCLK = MCLK/2 (init(): MCLKDIVCFG RATIO_1_2_4)
#define IO_CLK_CNT(rate) ((IO_CLK + ((rate) >> 1)) / (rate))
// UC4 (UC3-UC5 segment, 0x4064xxxx) BUSCLK = MCLK on silicon, not SemiMCLK as the SDK SysConfig metadata assumes
// (measured: the generated 16 MHz divisors 26/3 ran UC4 at 76800 baud). 64*BRD with 16x OVS, rounded as SysConfig does.
#define IO_UC4_BRD64 (((CLK * 8 / SIG_UART_UC4_BAUD_RATE) + 1) / 2)
#define PAGE_SIZE 2048
#if !defined IO_TIMER && !defined IO_PA2
#define IO_UC4
#endif

#if defined IO_TIMER && defined IO_PA2
#error "IO_TIMER and IO_PA2 are mutually exclusive"
#endif
#if defined IO_UC4 && (defined IO_TIMER || defined IO_PA2)
#error "IO_UC4, IO_TIMER and IO_PA2 are mutually exclusive"
#endif
#if defined IO_TIMER && !defined IO_PIN_PA27 || defined IO_PA2 && defined IO_PIN_PA27
#error "IO_TIMER requires IO_PIN_PA27 (SIG_TIMER on PA27), IO_PA2 requires PA26 (SIG_UART_PA26)"
#endif
#ifdef IO_RXTX
#error "IO_RXTX not supported on AM13E230X"
#endif

#ifdef IO_PIN_PA27
#define IO_PAD 27 // A27 (PINCM 27, GPIO0 bit 27)
#define IO_CC 1 // A27 (TIMG4_0_CCP1)
#else
#define IO_PAD 26 // A26 (PINCM 26, GPIO0 bit 26)
#define IO_CC 0 // A26 (TIMG4_0_CCP0)
#endif
#define IO_PF_RX 8 // UC0_RX_SCL_SCLK (A26/A27)
#define IO_PF_TX 9 // UC0_TX_SDA_PICO (A26/A27)
#define IO_PF_TIM 3 // TIMG4_0_CCP0 (A26) / TIMG4_0_CCP1 (A27)
#define IO_PINCM(pf) ((pf) | IOMUX_PINCM_PC_CONNECTED | IOMUX_PINCM_INENA_ENABLE | IOMUX_PINCM_PIPU_ENABLE) // Input + pull-up
#define IO_CTL0 (UNICOMMUART_CTL0_TXE_ENABLE | UNICOMMUART_CTL0_MAJVOTE_ENABLE) // UC0 TX + noise detection
#define IO_CCU (GPTIMER_CPU_INT_RIS_CCU0_MASK << IO_CC) // TIMG4 half-bit compare (pin channel)
#define IO_CAP ((GPTIMER_CPU_INT_RIS_CCU0_MASK | GPTIMER_CPU_INT_RIS_CCD0_MASK) << (IO_CC ^ 1)) // TIMG4 falling-edge capture (pair channel)

#define WRP_REC_ADDR 0x7F800
#define WRP_REC_MAGIC 0x32ea5752 // Write protection record slot
