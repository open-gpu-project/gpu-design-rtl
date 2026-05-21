module top #() (
    input logic dsp_clk,
    input logic fab_in_clk,
    input logic fab_out_clk,
    input logic rst,
    input logic [3:0] addr_srl,

    // BRAM interface
    input logic [9:0] ADDR_A,
    input logic EN_A,
    input logic WE_A,
    input logic [35:0] DI_A,
    input logic [9:0] ADDR_B,
    input logic EN_B,
    input logic WE_B,
    input logic [35:0] DI_B,
    // Control and data signals to/from ALU
    input logic [1:0] mode,
    input xu_priv::dsp_ctl l0dsp_control,
    input xu_priv::dsp_ctl l1dsp_control,
    input xu_priv::dsp_casc_in l1dsp_casc_in,
    output xu_priv::dsp_casc_out l0dsp_casc_out,

    input logic ce
);

wire [35:0] DO_A;
wire [35:0] DO_B;
wire [17:0] l0y1, l0y2, l1y1, l1y2;

bram_wrapper u_bram_wrapper(
    .clk    (fab_in_clk    ),
    .rst    (rst    ),
    .ADDR_A (ADDR_A ),
    .EN_A   (EN_A   ),
    .WE_A   (WE_A   ),
    .DI_A   (DI_A   ),
    .DO_A   (DO_A   ),
    .ADDR_B (ADDR_B ),
    .EN_B   (EN_B   ),
    .WE_B   (WE_B   ),
    .DI_B   (DI_B   ),
    .DO_B   (DO_B   )
);

alu u_alu(
    .dsp_clk        (dsp_clk        ),
    .fab_in_clk     (fab_in_clk     ),
    .fab_out_clk    (fab_out_clk    ),
    .rst            (rst            ),
    .mode           (mode           ),
    .l0x1           ({{6{DO_A[35]}},DO_A[35:18]}),
    .l0x2           (DO_A[17:0]           ),
    .l0y1           (l0y1           ),
    .l0y2           (l0y2           ),
    .l0acc1         (l0acc[35:18]         ),
    .l0acc2         (l0acc[17:0]         ),
    .l0dsp_control  (l0dsp_control  ),
    .l1x1           ({{6{DO_B[35]}},DO_B[35:18]}           ),
    .l1x2           (DO_B[17:0]           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l1acc1         (l1acc[35:18]         ),
    .l1acc2         (l1acc[17:0]         ),
    .l1dsp_control  (l1dsp_control  ),
    .l1dsp_casc_in  (l1dsp_casc_in  ),
    .l0dsp_casc_out (l0dsp_casc_out )
);

wire [35:0] l0acc;

alu_acc_reg 
#(
    .WIDTH (36)
)
u_alu_acc_reg_l0(
    .clk (fab_in_clk ),
    .rst (rst ),
    .ce  (ce  ),
    .d   ({l0y1,l0y2}   ),
    .q   (l0acc   ),
    .depth (addr_srl)
);

wire [35:0] l1acc;

alu_acc_reg 
#(
    .WIDTH (36)
)
u_alu_acc_reg_l1(
    .clk (fab_in_clk ),
    .rst (rst ),
    .ce  (ce  ),
    .d   ({l1y1,l1y2}   ),
    .q   (l1acc   ),
    .depth (addr_srl)
);

    
endmodule
