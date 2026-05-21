`default_nettype none
`include "xu_priv.svh"

module alu (
    input logic dsp_clk,
    input logic fab_in_clk,
    input logic fab_out_clk,
    input logic rst,
    input logic [1:0] mode,

    input logic [23:0] l0x1,
    input logic [17:0] l0x2,
    output logic [17:0] l0y1,
    output logic [17:0] l0y2,
    input logic [17:0] l0acc1,
    input logic [17:0] l0acc2,
    input xu_priv::dsp_ctl l0dsp_control,
    input logic [23:0] l1x1,
    input logic [17:0] l1x2,
    output logic [17:0] l1y1,
    output logic [17:0] l1y2,
    input logic [17:0] l1acc1,
    input logic [17:0] l1acc2,
    input xu_priv::dsp_ctl l1dsp_control,
    input xu_priv::dsp_casc_in l1dsp_casc_in,
    output xu_priv::dsp_casc_out l0dsp_casc_out
);

xu_priv::alu_lane_ctl alu_ctl;
assign alu_ctl.mode = mode;

xu_priv::dsp_casc_out l1dsp_casc_out;

alu_lane #(
    .MODE4_HIGH_LANE(1'b1)
) alu_lane_0(
    .dsp_clk      (dsp_clk      ),
    .dsp_rst      (rst      ),
    .fab_in_clk   (fab_in_clk   ),
    .fab_in_rst   (rst   ),
    .fab_out_clk  (fab_out_clk  ),
    .fab_out_rst  (rst  ),
    .alu_ctl      (alu_ctl      ),
    .X1           (l0x1           ),
    .AccIn1       (l0acc1       ),
    .X2           (l0x2           ),
    .AccIn2       (l0acc2       ),
    .dsp_control  (l0dsp_control  ),
    .dsp_casc_in  (l1dsp_casc_out  ),
    .dsp_casc_out (l0dsp_casc_out ),
    .Y1           (l0y1           ),
    .Y2           (l0y2           )
);

alu_lane #(
    .MODE4_HIGH_LANE(1'b0)
) alu_lane_1(
    .dsp_clk      (dsp_clk      ),
    .dsp_rst      (rst      ),
    .fab_in_clk   (fab_in_clk   ),
    .fab_in_rst   (rst   ),
    .fab_out_clk  (fab_out_clk  ),
    .fab_out_rst  (rst  ),
    .alu_ctl      (alu_ctl      ),
    .X1           (l1x1           ),
    .AccIn1       (l1acc1       ),
    .X2           (l1x2           ),
    .AccIn2       (l1acc2       ),
    .dsp_control  (l1dsp_control  ),
    .dsp_casc_in  (l1dsp_casc_in  ),
    .dsp_casc_out (l1dsp_casc_out ),
    .Y1           (l1y1           ),
    .Y2           (l1y2           )
);

    
endmodule
