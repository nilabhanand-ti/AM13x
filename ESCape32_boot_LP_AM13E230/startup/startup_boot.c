/*
** Minimal register-level startup for the ESCape32 bootloader on AM13E230x.
** Shared by the CCS project (TI Arm Clang) and the standalone CMake front-end
** (TI Arm Clang or arm-none-eabi-gcc).
**
** No C runtime initialisation is used (no _c_int00, __TI_auto_init, .cinit,
** SystemInit, Device_Init or SYSCFG_DL_init). The linker scripts export the
** load/run symbols used below:
**   linker/boot_ticlang.cmd (CCS + CMake ticlang)
**   <cmake>/linker/boot_gcc.ld (CMake gcc)
*/

#include <stdint.h>
#include <soc.h>

extern uint32_t __StackTop[];
extern uint32_t __ramfunct_load__[], __ramfunct_start__[], __ramfunct_end__[];
extern uint32_t __data_load__[], __data_start__[], __data_end__[];
extern uint32_t __bss_start__[], __bss_end__[];

void main(void);
void Reset_Handler(void);
void Default_Handler(void);

/* Core exception vectors only: the bootloader is polled and enables no device IRQs. */
__attribute__((used, section(".vectors")))
void (*const vectors[16])(void) = {
	(void (*)(void))((uint32_t)__StackTop), /* Initial MSP = __StackTop = _ram_end */
	Reset_Handler,
	Default_Handler, /* NMI */
	Default_Handler, /* HardFault */
	Default_Handler, /* MemManage */
	Default_Handler, /* BusFault */
	Default_Handler, /* UsageFault */
	Default_Handler, /* SecureFault (unused, TrustZone off) */
	Default_Handler, /* Reserved */
	Default_Handler, /* Reserved */
	Default_Handler, /* Reserved */
	Default_Handler, /* SVCall */
	Default_Handler, /* DebugMonitor */
	Default_Handler, /* Reserved */
	Default_Handler, /* PendSV */
	Default_Handler, /* SysTick */
};

void Reset_Handler(void) {
	/* Hard-float ABI: grant CP10/CP11 full access before any compiler-generated FPU use */
	SCB->CPACR |= (3UL << 20) | (3UL << 22);
	__DSB();
	__ISB();

	/* Plain word loops; volatile destinations stop the compilers from emitting memcpy/memset */
	const uint32_t *src = __ramfunct_load__;
	volatile uint32_t *dst = __ramfunct_start__;
	while (dst < __ramfunct_end__) *dst++ = *src++;
	src = __data_load__;
	dst = __data_start__;
	while (dst < __data_end__) *dst++ = *src++;
	dst = __bss_start__;
	while (dst < __bss_end__) *dst++ = 0;
	__DSB();
	__ISB();

	main();
	for (;;);
}

void Default_Handler(void) {
	for (;;);
}
