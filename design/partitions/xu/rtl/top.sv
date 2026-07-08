`default_nettype none

module top #() (
    input logic dsp_clk,
    input logic dsp_clk_div2,
    input logic rst,
    // input logic [5:0] addr_srl,

    // BRAM interface
    input logic [9:0] ADDR_A,
    input logic EN_A,
    input logic WE_A,
    input logic [35:0] DI_A,
    input logic [9:0] ADDR_B,
    input logic EN_B,
    input logic WE_B,
    input logic [35:0] DI_B,
    // input logic bram_load_mode,
    // Control and data signals to/from ALU
    // input logic [1:0] mode,
    // input logic mode1_sel_low,
    // input logic [1:0] slice_sel_24bit,
    // input xu_priv::dsp_ctl l0dsp_control,
    // input xu_priv::dsp_ctl l1dsp_control,
    input xu_priv::xu_ctl xu_ctl_in,
    input xu_priv::dsp_casc_in l1dsp_casc_in,
    output xu_priv::dsp_casc_out l0dsp_casc_out,
    
    output [17:0] l0y1_o,
    output [17:0] l0y2_o,
    output [17:0] l1y1_o,
    output [17:0] l1y2_o

    // input logic pipe_ce
);

wire [35:0] DO_A;
wire [35:0] DO_B;
wire [17:0] l0y1, l0y2, l1y1, l1y2;
wire [35:0] bram_di_a;
wire [35:0] bram_di_b;
// wire acc_read = addr_srl[6];

wire [23:0] l0x1, l1x1;
wire [17:0] l0x2, l1x2;

assign l0y1_o = l0y1;
assign l0y2_o = l0y2;
assign l1y1_o = l1y1;
assign l1y2_o = l1y2;

// assign bram_di_a = bram_load_mode ? DI_A : l0acc;
// assign bram_di_b = bram_load_mode ? DI_B : l1acc;

// Accumulator timing (cycle i = interval after dsp_clk_div2 edge i; an op's
// ctl and BRAM address are driven during cycle i):
//
//   cycle:     i          i+3                 i+8                edge i+9
//   producer:  issue      reads acc (tap[2])  l*acc_in valid     RF[waddr]
//                                             we/waddr (tap[7])  committed
//
//   consumer issued at j reads the RF asynchronously during cycle j+3:
//     j - i == 5  -> result not yet committed: use bypass_acc to forward the
//                    combinational l*acc_in (producer's result is on it now)
//     j - i >= 6  -> read the committed RF slot
//
// The bypass path is combinational (alu Y -> lane_output_logic -> mux -> alu
// input reg); acceptable for now, revisit at floorplanning.

xu_priv::xu_ctl xu_ctl_pipe_out [7:0];
xu_ctl_pipe u_xu_ctl_pipe(
    .xu_ctl_in       (xu_ctl_in       ),
    .clk             (dsp_clk_div2      ),
    .rst             (rst             ),
    .ce              (1'b1             ),
    .xu_ctl_pipe_out (xu_ctl_pipe_out )
);


bram_wrapper u_bram_wrapper(
    .clk    (dsp_clk_div2    ),
    .rst    (rst    ),
    .ADDR_A (ADDR_A ),
    .EN_A   (EN_A   ),
    .WE_A   (WE_A   ),
    .DI_A   (DI_A),
    .DO_A   (DO_A   ),
    .ADDR_B (ADDR_B ),
    .EN_B   (EN_B   ),
    .WE_B   (WE_B   ),
    .DI_B   (DI_B),
    .DO_B   (DO_B   )
);

lane_input_logic u_lane_input_logic(
    .clk             (dsp_clk_div2             ),
    .rst             (rst             ),
    .pA              (DO_A              ),
    .pB              (DO_B              ),
    .l0x1            (l0x1            ),
    .l0x2            (l0x2            ),
    .l1x1            (l1x1            ),
    .l1x2            (l1x2            ),
    .mode            (xu_ctl_pipe_out[2].mode            ),
    .mode1_sel_low   (xu_ctl_pipe_out[2].mode1_sel_low   ),
    .slice_sel_24bit (xu_ctl_pipe_out[2].slice_sel_24bit )
);

alu u_alu(
    .dsp_clk        (dsp_clk        ),
    .fab_in_clk     (dsp_clk_div2     ),
    .fab_out_clk    (dsp_clk_div2    ),
    .rst            (rst            ),
    .mode           (xu_ctl_pipe_out[2].mode           ),
    .l0x1           (l0x1),
    .l0x2           (l0x2),
    .l0y1           (l0y1           ),
    .l0y2           (l0y2           ),
    .l0acc1         (l0acc_sel[35:18]),
    .l0acc2         (l0acc_sel[17:0] ),
    .l0dsp_control  (xu_ctl_pipe_out[2].l0dsp_control  ),
    .l1x1           (l1x1           ),
    .l1x2           (l1x2           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l1acc1         (l1acc_sel[35:18]),
    .l1acc2         (l1acc_sel[17:0] ),
    .l1dsp_control  (xu_ctl_pipe_out[2].l1dsp_control  ),
    .l1dsp_casc_in  (l1dsp_casc_in  ),
    .l0dsp_casc_out (l0dsp_casc_out )
);

lane_output_logic u_lane_output_logic(
    .fab_out_clk    (dsp_clk_div2    ),
    .mode           (xu_ctl_pipe_out[7].mode           ),
    .l0y1           (l0y1           ),
    .l0y2           (l0y2           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l0acc_in       (l0acc_in        ),
    .l1acc_in       (l1acc_in        )
);

wire [35:0] l0acc_in;
wire [35:0] l0acc_out;

acc_reg_file
#(
    .WIDTH (36),
    .DEPTH (32)
)
u_acc_reg_file_l0(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_pipe_out[7].acc_we   ),
    .waddr (xu_ctl_pipe_out[7].acc_waddr),
    .wdata (l0acc_in),
    .raddr (xu_ctl_pipe_out[2].acc_raddr),
    .rdata (l0acc_out)
);

wire [35:0] l1acc_in;
wire [35:0] l1acc_out;

acc_reg_file
#(
    .WIDTH (36),
    .DEPTH (32)
)
u_acc_reg_file_l1(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_pipe_out[7].acc_we   ),
    .waddr (xu_ctl_pipe_out[7].acc_waddr),
    .wdata (l1acc_in),
    .raddr (xu_ctl_pipe_out[2].acc_raddr),
    .rdata (l1acc_out)
);

// Forward the in-flight result past the register file for dependency distance
// FWD_DISTANCE (see timing comment above).
wire [35:0] l0acc_sel = xu_ctl_pipe_out[2].bypass_acc ? l0acc_in : l0acc_out;
wire [35:0] l1acc_sel = xu_ctl_pipe_out[2].bypass_acc ? l1acc_in : l1acc_out;

endmodule
