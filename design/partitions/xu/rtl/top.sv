`default_nettype none

module top #() (
    input logic dsp_clk,
    input logic dsp_clk_div2,
    input logic rst,
    // input logic [5:0] addr_srl,

    // BRAM interface
    // input logic [9:0] ADDR_A,
    // input logic EN_A,
    // input logic WE_A,
    input logic [35:0] DI_A,
    // input logic [9:0] ADDR_B,
    // input logic EN_B,
    // input logic WE_B,
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
    output xu_priv::dsp_casc_out l0dsp_casc_out
    
    // output [17:0] l0y1_o,
    // output [17:0] l0y2_o,
    // output [17:0] l1y1_o,
    // output [17:0] l1y2_o

    // input logic pipe_ce
);

wire [35:0] DO_A;
wire [35:0] DO_B;
wire [17:0] l0y1, l0y2, l1y1, l1y2;
logic [35:0] bram_di_a;
logic [35:0] bram_di_b;
logic [9:0]  bram_addr_a;
logic [9:0]  bram_addr_b;
logic [3:0]       bram_we_a;
logic [3:0]       bram_we_b;
logic        bram_en_a;
logic        bram_en_b;
// wire acc_read = addr_srl[6];

wire [23:0] l0x1, l1x1;
wire [17:0] l0x2, l1x2;

// assign l0y1_o = l0y1;
// assign l0y2_o = l0y2;
// assign l1y1_o = l1y1;
// assign l1y2_o = l1y2;

// assign bram_di_a = bram_load_mode ? DI_A : l0acc;
// assign bram_di_b = bram_load_mode ? DI_B : l1acc;

// Accumulator timing (cycle i = interval after dsp_clk_div2 edge i; an op's
// ctl and BRAM address are driven during cycle i):
//
//   cycle:     i          i+3                 i+8                edge i+9
//   producer:  issue      reads acc (tap[2])  l*acc_in valid     RF[waddr]
//                                             we/waddr (tap[7])  committed
//
//   consumer issued at j reads the RF asynchronously during cycle j+3, so it
//   needs j - i >= 6 from the producer of its slot. There is no forwarding
//   path: the issue schedule must keep dependent ops >= 6 apart (trivially
//   true under 8-strand round-robin, where same-strand ops are 8 apart).

xu_priv::xu_ctl xu_ctl_taps_out [7:0];
xu_ctl_delay_tap u_xu_ctl_delay_tap(
    .xu_ctl_in       (xu_ctl_in       ),
    .clk             (dsp_clk_div2      ),
    .rst             (rst             ),
    .ce              (1'b1             ),
    .xu_ctl_taps_out (xu_ctl_taps_out )
);

bram_wrapper u_bram_wrapper(
    .clk    (dsp_clk_div2    ),
    .rst    (rst    ),
    .ADDR_A (bram_addr_a ),
    .EN_A   (bram_en_a   ),
    .WE_A   (bram_we_a   ),
    .DI_A   (bram_di_a   ),
    .DO_A   (DO_A   ),
    .ADDR_B (bram_addr_b ),
    .EN_B   (bram_en_b   ),
    .WE_B   (bram_we_b   ),
    .DI_B   (bram_di_b   ),
    .DO_B   (DO_B   )
);

lane_input_logic u_lane_input_logic(
    .clk             (dsp_clk_div2             ),
    .rst             (rst             ),
    .pA              (xu_ctl_taps_out[2].zero_bram_operands ? 36'h0 : DO_A              ),
    .pB              (xu_ctl_taps_out[2].zero_bram_operands ? 36'h0 : DO_B              ),
    .l0x1            (l0x1            ),
    .l0x2            (l0x2            ),
    .l1x1            (l1x1            ),
    .l1x2            (l1x2            ),
    .mode            (xu_ctl_taps_out[2].mode[1:0]            ),
    .mode1_sel_low   (xu_ctl_taps_out[2].mode1_sel_low   ),
    .slice_sel_24bit (xu_ctl_taps_out[2].slice_sel_24bit )
);

logic [17:0] l0acc_alu_in_lo, l0acc_alu_in_hi, l1acc_alu_in_lo, l1acc_alu_in_hi;
always_comb begin
    if (xu_ctl_taps_out[2].mode == xu_priv::FMA18) begin
        l0acc_alu_in_lo = xu_ctl_taps_out[2].mode1_sel_low ? l0acc_out_lo : l0acc_out_hi;
        l0acc_alu_in_hi = 0;
        l1acc_alu_in_lo = xu_ctl_taps_out[2].mode1_sel_low ? l1acc_out_lo : l1acc_out_hi;
        l1acc_alu_in_hi = 0;
    end else begin
        l0acc_alu_in_lo = l0acc_out_lo;
        l0acc_alu_in_hi = l0acc_out_hi;
        l1acc_alu_in_lo = l1acc_out_lo;
        l1acc_alu_in_hi = l1acc_out_hi;
    end
end

// Bit order: {l1_lo, l1_hi, l0_lo, l0_hi}
logic [3:0] eq_at_input;
logic [3:0] eq_pipe [0:4];

assign eq_at_input = {
    (l1x2        == l1acc_alu_in_lo),
    (l1x1[17:0] == l1acc_alu_in_hi),
    (l0x2        == l0acc_alu_in_lo),
    (l0x1[17:0] == l0acc_alu_in_hi)
};

always_ff @(posedge dsp_clk_div2) begin
    if (rst) begin
        for (int i = 0; i < 5; i++)
            eq_pipe[i] <= '0;
    end else begin
        eq_pipe[0] <= eq_at_input;
        for (int i = 1; i < 5; i++)
            eq_pipe[i] <= eq_pipe[i-1];
    end
end

assign l0eq = eq_pipe[4][1:0];
assign l1eq = eq_pipe[4][3:2];

alu u_alu(
    .dsp_clk        (dsp_clk        ),
    .fab_in_clk     (dsp_clk_div2     ),
    .fab_out_clk    (dsp_clk_div2    ),
    .rst            (rst            ),
    .mode           (xu_ctl_taps_out[2].mode           ),
    .l0x1           (l0x1),
    .l0x2           (l0x2),
    .l0y1           (l0y1           ),
    .l0y2           (l0y2           ),
    .l0acc1         (l0acc_alu_in_hi),
    .l0acc2         (l0acc_alu_in_lo ),
    .l0dsp_control  (xu_ctl_taps_out[2].l0dsp_control  ),
    .l1x1           (l1x1           ),
    .l1x2           (l1x2           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l1acc1         (l1acc_alu_in_hi),
    .l1acc2         (l1acc_alu_in_lo ),
    .l1dsp_control  (xu_ctl_taps_out[2].l1dsp_control  ),
    .l1dsp_casc_in  (l1dsp_casc_in  ),
    .l0dsp_casc_out (l0dsp_casc_out )
);

// predicate registers
logic [1:0] l0ge, l0gt, l0ne, l0eq, l0le, l0lt;
logic [1:0] l1ge, l1gt, l1ne, l1eq, l1le, l1lt;
always_comb begin
    l0ge = {l0y2[0], l0y1[0]};
    // l0eq = {l0x2==l0y2,l0x1[17:0]==l0y1};
    l0ne = ~l0eq;
    l0gt = l0ge & ~l0eq;
    l0le = ~l0ge | l0eq;
    l0lt = ~l0ge;

    l1ge = {l1y2[0], l1y1[0]};
    // l1eq = {l1x2==l1y2,l1x1[17:0]==l1y1};
    l1ne = ~l1eq;
    l1gt = l1ge & ~l1eq;
    l1le = ~l1ge | l1eq;
    l1lt = ~l1ge;
end

always_ff @(posedge dsp_clk_div2) begin
    if (xu_ctl_taps_out[7].pred_we) begin
        pred_mem[xu_ctl_taps_out[7].pred_waddr] <= pred_write_data;
    end
end

always_comb begin
    case (xu_ctl_taps_out[7].pred_cond)
        xu_priv::PRED_EQ: pred_write_data = {l1eq, l0eq};
        xu_priv::PRED_NE: pred_write_data = {l1ne, l0ne};
        xu_priv::PRED_LT: pred_write_data = {l1lt, l0lt};
        xu_priv::PRED_LE: pred_write_data = {l1le, l0le};
        xu_priv::PRED_GT: pred_write_data = {l1gt, l0gt};
        xu_priv::PRED_GE: pred_write_data = {l1ge, l0ge};
        default:          pred_write_data = 4'b0000;
    endcase
end

// lane output
lane_output_logic u_lane_output_logic(
    .fab_out_clk    (dsp_clk_div2    ),
    .mode           (xu_ctl_taps_out[7].mode[1:0]           ),
    .l0y1           (l0y1           ),
    .l0y2           (l0y2           ),
    .l1y1           (l1y1           ),
    .l1y2           (l1y2           ),
    .l0_result       (l0_result        ),
    .l1_result       (l1_result        )
);

// predicate read
logic [3:0] pred_mem [0:31];
logic [3:0] pred_read;
logic [3:0] pred_write_data;

always_ff @(posedge dsp_clk_div2) begin
    pred_read <= pred_mem[xu_ctl_taps_out[6].pred_raddr];
end

logic [3:0] exec_mask;
assign exec_mask = xu_ctl_taps_out[7].pred_enable ? 
                    pred_read ^ {4{xu_ctl_taps_out[7].pred_invert}} :
                    4'b1111;

// bram writeback
always_comb begin
    // Default: normal external/USC access
    bram_di_a   = DI_A;
    bram_addr_a = xu_ctl_in.ADDR_A;
    bram_en_a   = xu_ctl_in.EN_A;
    bram_we_a   = xu_ctl_in.WE_A;

    // ALU writeback overrides the port
    if (xu_ctl_taps_out[7].l0_wb_valid) begin
        bram_di_a   = l0_result;
        bram_addr_a = xu_ctl_taps_out[7].WB_ADDR_A;
        bram_en_a   = 1'b1;
        bram_we_a   = xu_ctl_taps_out[7].WB_WE_A & {{2{exec_mask[0]}}, {2{exec_mask[1]}}};;
    end

    bram_di_b   = DI_B;
    bram_addr_b = xu_ctl_in.ADDR_B;
    bram_en_b   = xu_ctl_in.EN_B;
    bram_we_b   = xu_ctl_in.WE_B;

    if (xu_ctl_taps_out[7].l1_wb_valid) begin
        bram_di_b   = l1_result;
        bram_addr_b = xu_ctl_taps_out[7].WB_ADDR_B;
        bram_en_b   = 1'b1;
        bram_we_b   = xu_ctl_taps_out[7].WB_WE_B & {{2{exec_mask[2]}}, {2{exec_mask[3]}}};;
    end
end

// accumulator writeback
logic [35:0] l0_result;
logic [17:0] l0acc_out_hi, l0acc_out_lo; 
logic [17:0] l0acc_in_hi, l0acc_in_lo;

always_comb begin
    if (xu_ctl_taps_out[7].mode == xu_priv::FMA18) begin
        l0acc_in_hi = xu_ctl_taps_out[7].mode1_sel_low ? 0 : l0_result[17:0];
        l0acc_in_lo = xu_ctl_taps_out[7].mode1_sel_low ? l0_result[17:0] : 0;
    end else begin
        l0acc_in_hi = l0_result[35:18];
        l0acc_in_lo = l0_result[17:0];
    end
end

acc_reg_file
#(
    .WIDTH (18),
    .DEPTH (32)
)
u_acc_reg_file_l0_hi(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_taps_out[7].acc_we && (xu_ctl_taps_out[7].mode != xu_priv::FMA18 || xu_ctl_taps_out[7].mode1_sel_low == 1'b0)),
    .waddr (xu_ctl_taps_out[7].acc_waddr),
    .wdata (l0acc_in_hi),
    .raddr (xu_ctl_taps_out[2].acc_raddr),
    .rdata (l0acc_out_hi)
);

acc_reg_file
#(
    .WIDTH (18),
    .DEPTH (32)
)
u_acc_reg_file_l0_lo(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_taps_out[7].acc_we && (xu_ctl_taps_out[7].mode != xu_priv::FMA18 || xu_ctl_taps_out[7].mode1_sel_low == 1'b1)),
    .waddr (xu_ctl_taps_out[7].acc_waddr),
    .wdata (l0acc_in_lo),
    .raddr (xu_ctl_taps_out[2].acc_raddr),
    .rdata (l0acc_out_lo)
);

logic [35:0] l1_result;
logic [17:0] l1acc_out_hi, l1acc_out_lo; 
logic [17:0] l1acc_in_hi, l1acc_in_lo;

always_comb begin
    if (xu_ctl_taps_out[7].mode == xu_priv::FMA18) begin
        l1acc_in_hi = xu_ctl_taps_out[7].mode1_sel_low ? 0 : l1_result[17:0];
        l1acc_in_lo = xu_ctl_taps_out[7].mode1_sel_low ? l1_result[17:0] : 0;
    end else begin
        l1acc_in_hi = l1_result[35:18];
        l1acc_in_lo = l1_result[17:0];
    end
end

acc_reg_file
#(
    .WIDTH (18),
    .DEPTH (32)
)
u_acc_reg_file_l1_hi(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_taps_out[7].acc_we && (xu_ctl_taps_out[7].mode != xu_priv::FMA18 || xu_ctl_taps_out[7].mode1_sel_low == 1'b0)),
    .waddr (xu_ctl_taps_out[7].acc_waddr),
    .wdata (l1acc_in_hi),
    .raddr (xu_ctl_taps_out[2].acc_raddr),
    .rdata (l1acc_out_hi)
);

acc_reg_file
#(
    .WIDTH (18),
    .DEPTH (32)
)
u_acc_reg_file_l1_lo(
    .clk   (dsp_clk_div2),
    .we    (xu_ctl_taps_out[7].acc_we && (xu_ctl_taps_out[7].mode != xu_priv::FMA18 || xu_ctl_taps_out[7].mode1_sel_low == 1'b1)),
    .waddr (xu_ctl_taps_out[7].acc_waddr),
    .wdata (l1acc_in_lo),
    .raddr (xu_ctl_taps_out[2].acc_raddr),
    .rdata (l1acc_out_lo)
);

endmodule
