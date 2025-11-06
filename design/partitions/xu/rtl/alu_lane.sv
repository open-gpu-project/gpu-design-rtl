`default_nettype none
`timescale 1ns/1ns
`include "xu_priv.svh"

module alu_lane #(
    // (24-bit) fixed point location
    parameter int FXP24_LOC = 8,
    // (18 bit) fixed point location
    parameter int FXP18_LOC = 8,
    // (18 bit) fixed point location for LERP factor
    parameter int LERP_FXP18_LOC = 16
) (
    input logic clk,
    input logic rst,

    // ALU input datapath
    input logic[23:0] X1,
    input logic[18:0] AccIn1,
    input logic[17:0] X2,
    input logic[17:0] AccIn2,

    // Exposed internal DSP interface
    input   xu_priv::dsp_ctl        dsp_control,
    input   xu_priv::dsp_casc_in    dsp_casc_in,
    output  xu_priv::dsp_casc_out   dsp_casc_out,

    // ALU output datapath
    output logic[17:0] Y1,
    output logic[17:0] AccOut1,
    output logic[17:0] Y2,
    output logic[17:0] AccOut2
);
    // Pre-define some input signals for clarity
    logic[29:0] X1Zext = {6'b0, X1};
    logic[29:0] X1Sext = {{6{X1[23]}}, X1};
    logic[36:0] Acc1Acc2In = {AccIn1, AccIn2};

    // Motivation: Parallel 18-bit addition
    xu_priv::dsp_input mode1_18b_input;
    assign mode1_18b_input.A = X1Zext;
    assign mode1_18b_input.B = X2;
    assign mode1_18b_input.C = {11'b0, Acc1Acc2In};
    assign mode1_18b_input.D = 0;

    // Motivation: 18-bit multiplication + addition
    xu_priv::dsp_input mode2_18b_input;
    logic[FXP18_LOC-1:0] MODE2_C_PAD_LO = 0;
    logic[48-FXP18_LOC-18-1:0] MODE2_C_PAD_HI;
    assign MODE2_C_PAD_HI = {$bits(MODE2_C_PAD_HI){AccIn2[17]}};
    assign mode2_18b_input.A = X1Sext;
    assign mode2_18b_input.B = mode1_18b_input.B;
    assign mode2_18b_input.C = {MODE2_C_PAD_HI, AccIn2, MODE2_C_PAD_LO};
    assign mode2_18b_input.D = 0;

    // Motivation: 24-bit addition (X1:X2 + Acc1:Acc2)
    xu_priv::dsp_input mode3_24b_input;
    assign mode3_24b_input.A = X1Zext;
    assign mode3_24b_input.B = X2;
    assign mode3_24b_input.C = {11'b0, Acc1Acc2In};
    assign mode3_24b_input.D = mode1_18b_input.D;

    // Motivation: 24-bit multiplication + addition;
    xu_priv::dsp_input mode4_24b_input;
    logic[FXP24_LOC-1:0] MODE4_C_PAD_LO = 0;
    logic[48-FXP24_LOC-24-1:0] MODE4_C_PAD_HI;
    assign MODE4_C_PAD_HI = {$bits(MODE4_C_PAD_HI){Acc1Acc2In[23]}};
    assign mode4_24b_input.A = X1Sext;
    assign mode4_24b_input.B = X2;
    assign mode4_24b_input.C = {MODE4_C_PAD_HI, Acc1Acc2In[23:0], MODE4_C_PAD_LO};
    assign mode4_24b_input.D = 0;

    // Registered control signals
    xu_priv::dsp_ctl dsp_control_reg;
    always @(posedge clk)
    if(rst) begin
        dsp_control_reg <= '0;
    end else begin
        dsp_control_reg <= dsp_control;
    end

    // Input datapath to DSP
    xu_priv::dsp_input dsp_data_in;
    always @(posedge clk)
    if (rst) begin
        dsp_data_in <= '0;
    end else begin
        // FIXME(kevin): Implement proper input selection logic
    end

    // Output datapath from DSP
    xu_priv::dsp_output dsp_data_out;
    always @(posedge clk)
    if (rst) begin
        Y1 <= '0;
        AccOut1 <= '0;
        Y2 <= '0;
        AccOut2 <= '0;
    end else begin
        // FIXME(kevin): Implement proper output extraction logic
    end

    // Instantiate DSP wrapper
    alu_dsp_wrapper alu_dsp_wrapper_inst (
        .clk(clk),
        .rst(rst),
        .dsp_data_in(dsp_data_in),
        .dsp_control(dsp_control_reg),
        .dsp_casc_in(dsp_casc_in),
        .dsp_casc_out(dsp_casc_out),
        .dsp_data_out(dsp_data_out)
    );

    // Check parameter legality
    generate begin : parameter_checks
        if (FXP24_LOC <= 0 || FXP24_LOC > 23) begin
            $error("FXP24_LOC parameter out of range (0-23)");
        end
        if (FXP18_LOC <= 0 || FXP18_LOC > 17) begin
            $error("FXP18_LOC parameter out of range (0-17)");
        end
        if (LERP_FXP18_LOC <= 0 || LERP_FXP18_LOC > 17) begin
            $error("LERP_FXP18_LOC parameter out of range (0-17)");
        end
    end : parameter_checks
    endgenerate

endmodule

`default_nettype wire
