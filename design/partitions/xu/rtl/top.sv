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

// l0y*_d3 aligns previous ALU output with next dependent ALU input for ACC bypass.
// logic [17:0] l0y1_d1, l0y1_d2, l0y1_d3, l0y2_d1, l0y2_d2, l0y2_d3;
// logic [17:0] l1y1_d1, l1y1_d2, l1y1_d3, l1y2_d1, l1y2_d2, l1y2_d3;
logic [35:0] l0acc_in_d1, l0acc_in_d2, l0acc_in_d3;
logic [35:0] l1acc_in_d1, l1acc_in_d2, l1acc_in_d3;
always_ff @(posedge dsp_clk_div2) begin
    if (rst) begin
        l0acc_in_d1 <= 36'b0;
        l0acc_in_d2 <= 36'b0;
        l0acc_in_d3 <= 36'b0;
        l1acc_in_d1 <= 36'b0;
        l1acc_in_d2 <= 36'b0;
        l1acc_in_d3 <= 36'b0;
    end else begin
        l0acc_in_d1 <= l0acc_in;
        l0acc_in_d2 <= l0acc_in_d1;
        l0acc_in_d3 <= l0acc_in_d2;
        l1acc_in_d1 <= l1acc_in;
        l1acc_in_d2 <= l1acc_in_d1;
        l1acc_in_d3 <= l1acc_in_d2;
    end
end

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
    .l0acc1         (xu_ctl_pipe_out[2].bypass_acc ? l0acc_in_d3[35:18] : l0acc_out[35:18]         ),
    .l0acc2         (xu_ctl_pipe_out[2].bypass_acc ? l0acc_in_d3[17:0] : l0acc_out[17:0]         ),
    .l0dsp_control  (xu_ctl_pipe_out[2].l0dsp_control  ),
    .l1x1           (l1x1           ),
    .l1x2           (l1x2           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l1acc1         (xu_ctl_pipe_out[2].bypass_acc ? l1acc_in_d3[35:18] : l1acc_out[35:18]         ),
    .l1acc2         (xu_ctl_pipe_out[2].bypass_acc ? l1acc_in_d3[17:0] : l1acc_out[17:0]         ),
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

alu_acc_reg 
#(
    .WIDTH (36)
)
u_alu_acc_reg_l0(
    .clk (dsp_clk_div2 ),
    .rst (rst ),
    .ce  (xu_ctl_pipe_out[7].acc_ce  ),
    .d   (l0acc_in   ),
    .q   (l0acc_out   ),
    .depth (xu_ctl_pipe_out[2].addr_srl)
);

wire [35:0] l1acc_in;
wire [35:0] l1acc_out;

alu_acc_reg 
#(
    .WIDTH (36)
)
u_alu_acc_reg_l1(
    .clk (dsp_clk_div2 ),
    .rst (rst ),
    .ce  (xu_ctl_pipe_out[7].acc_ce  ),
    .d   (l1acc_in   ),
    .q   (l1acc_out   ),
    .depth (xu_ctl_pipe_out[2].addr_srl)
);

    
endmodule
