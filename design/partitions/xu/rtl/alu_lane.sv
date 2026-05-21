`default_nettype none
`timescale 1ns/1ns
`include "xu_priv.svh"

module alu_lane #(
    // (24-bit) fixed point location
    parameter int FXP24_LOC = 8,
    // (18 bit) fixed point location
    parameter int FXP18_LOC = 8,
    // (18 bit) fixed point location for LERP factor
    parameter int LERP_FXP18_LOC = 16,
    // Number of cycles of latency through the lane
    parameter int LANE_LATENCY = 4,
    // Mode 4 uses two lanes: high lane exposes P[6:0], low lane exposes P[24:8].
    parameter bit MODE4_HIGH_LANE = 1'b0
) (
    // Clocks and resets
    input logic dsp_clk,
    input logic dsp_rst,
    input logic fab_in_clk,
    input logic fab_in_rst,
    input logic fab_out_clk,
    input logic fab_out_rst,
    
    // ALU control signals
    input xu_priv::alu_lane_ctl alu_ctl,

    // ALU input datapath
    input logic[23:0] X1,
    input logic[17:0] AccIn1,
    input logic[17:0] X2,
    input logic[17:0] AccIn2,

    // Exposed internal DSP interface
    input   xu_priv::dsp_ctl        dsp_control,
    input   xu_priv::dsp_casc_in    dsp_casc_in,
    output  xu_priv::dsp_casc_out   dsp_casc_out,

    // ALU output datapath
    output logic[17:0] Y1,
    output logic[17:0] Y2
);
    // Pre-define some input signals for clarity
    logic [29:0] X1Zext;
    logic [29:0] X1Sext;
    logic [35:0] Acc1Acc2In;
    logic [47:0] Acc1PadAcc2In;

    assign X1Zext      = {6'b0, X1};
    assign X1Sext      = {{6{X1[23]}}, X1};
    assign Acc1Acc2In  = {AccIn1, AccIn2};
    assign Acc1PadAcc2In = {6'b0, AccIn1, 6'b0, AccIn2};

    // Let the DSP output be captured here
    xu_priv::dsp_output dsp_data_out_reg;

    // Motivation: Parallel 18-bit addition
    xu_priv::dsp_input mode1_18b_input;
    logic[17:0] mode1_Y1;
    logic[17:0] mode1_Y2;
    assign mode1_18b_input.A = {X1, 6'b0};
    assign mode1_18b_input.B = X2;
    assign mode1_18b_input.C = Acc1PadAcc2In;
    assign mode1_18b_input.D = 0;
    assign mode1_Y1 = dsp_data_out_reg.P[41:24];
    assign mode1_Y2 = dsp_data_out_reg.P[17:0];

    // Motivation: 18-bit multiplication + addition
    xu_priv::dsp_input mode2_18b_input;
    logic[17:0] mode2_Y1;
    logic[FXP18_LOC-1:0] MODE2_C_PAD_LO = 0;
    logic[48-FXP18_LOC-18-1:0] MODE2_C_PAD_HI;
    logic [17:0] AccIn2_d1;
    assign MODE2_C_PAD_HI = {$bits(MODE2_C_PAD_HI){AccIn2[17]}};
    assign mode2_18b_input.A = X1Sext;
    assign mode2_18b_input.B = mode1_18b_input.B;
    assign mode2_18b_input.C = {MODE2_C_PAD_HI, AccIn2, MODE2_C_PAD_LO};
    assign mode2_18b_input.D = 0;
    assign mode2_Y1 = dsp_data_out_reg.P[FXP18_LOC+17:FXP18_LOC];

    // Motivation: 24-bit addition (X1:X2 + Acc1:Acc2)
    xu_priv::dsp_input mode3_24b_input;
    logic[23:0] mode3_Y1Y2;
    logic[17:0] mode3_Y1;
    logic[17:0] mode3_Y2;
    // logic[35:0] Acc1Acc2In_d1;
    assign mode3_24b_input.A = X1Zext;
    assign mode3_24b_input.B = X2;
    assign mode3_24b_input.C = {12'b0, Acc1Acc2In};
    assign mode3_24b_input.D = 0;
    assign mode3_Y1Y2 = dsp_data_out_reg.P[23:0];
    assign mode3_Y1 = {12'b0, mode3_Y1Y2[23:18]};
    assign mode3_Y2 = mode3_Y1Y2[17:0];

    // Motivation: 24-bit multiplication + addition;
    xu_priv::dsp_input mode4_24b_input;
    logic[23:0] mode4_Y1Y2;
    logic[17:0] mode4_Y2;
    logic[FXP24_LOC-1:0] MODE4_C_PAD_LO = 0;
    logic[48-FXP24_LOC-24-1:0] MODE4_C_PAD_HI;
    assign MODE4_C_PAD_HI = {$bits(MODE4_C_PAD_HI){Acc1Acc2In[23]}};
    assign mode4_24b_input.A = X1Sext;
    assign mode4_24b_input.B = X2;
    assign mode4_24b_input.C = {MODE4_C_PAD_HI, Acc1Acc2In[23:0], MODE4_C_PAD_LO};
    assign mode4_24b_input.D = 0;
    // FIXME(kevin): Figure this part out...
    // assign mode4_Y1Y2 = 24'bx;
    assign mode4_Y2 = MODE4_HIGH_LANE ? { 3'b0, dsp_data_out_reg.P[14:0] } :
                                        { 9'b0, dsp_data_out_reg.P[16:8] };


    // Registered control signals
    xu_priv::dsp_ctl dsp_control_reg;

    always_ff @(posedge fab_in_clk)
    if (fab_in_rst) begin
        dsp_control_reg <= 0;
    end else begin
        dsp_control_reg <= dsp_control;
    end

    // Time-multiplexed OPMODE and ALUMODE muxing
    logic op_mux_sel;
    logic[3:0] muxed_ALUMODE;
    logic[6:0] muxed_OPMODE;
    always_ff @(posedge dsp_clk)
    if(dsp_rst) begin
        muxed_OPMODE <= 0;
        muxed_ALUMODE <= 0;
        op_mux_sel <= MODE4_HIGH_LANE ? 1'b1 : 1'b0;
    end else begin
        if(op_mux_sel) begin
            // X = 0, Y = 0, Z = PCIN
            muxed_OPMODE <= 7'b001_00_00;
            // X ^ Z
            muxed_ALUMODE <= 4'b0100;
        end else begin
            muxed_OPMODE <= dsp_control.OPMODE;
            muxed_ALUMODE <= dsp_control.ALUMODE;
        end
        op_mux_sel <= ~op_mux_sel;
    end

    // Assign muxed control signals
    xu_priv::dsp_ctl dsp_control_muxed;
    always_comb begin
        dsp_control_muxed = dsp_control_reg;
        dsp_control_muxed.OPMODE = muxed_OPMODE;
        dsp_control_muxed.ALUMODE = muxed_ALUMODE;
    end

    // Input datapath to DSP
    xu_priv::dsp_input dsp_data_in;
    xu_priv::dsp_input dsp_data_in_reg;
    logic [47:0] dsp_data_in_creg;


    always_ff @(posedge fab_in_clk) begin
        if (fab_in_rst) begin
            dsp_data_in <= 0;
        end else begin
            // FIXME(kevin): Need to manually optimize mux tree here
            case (alu_ctl.mode)
                2'b00: dsp_data_in <= mode1_18b_input;
                2'b01: dsp_data_in <= mode2_18b_input;
                2'b10: dsp_data_in <= mode3_24b_input;
                2'b11: dsp_data_in <= mode4_24b_input;
            endcase
        end
    end

    always_ff @( posedge dsp_clk ) begin
        dsp_data_in_creg <= dsp_data_in.C;
    end

    always_comb begin
        dsp_data_in_reg.A = dsp_data_in.A;
        dsp_data_in_reg.B = dsp_data_in.B;
        dsp_data_in_reg.C = dsp_data_in_creg;
        dsp_data_in_reg.D = dsp_data_in.D;    
    end

    // Output datapath from DSP
    logic[1:0] alu_mode_reg[LANE_LATENCY-1:0];
    xu_priv::dsp_output dsp_data_out;

    generate
        if (MODE4_HIGH_LANE) begin : gen_high_lane_output
            xu_priv::dsp_output p_delay;
            always_ff @( posedge dsp_clk ) begin
                p_delay <= dsp_data_out;
            end

            always_ff @(posedge fab_out_clk)
            if (fab_out_rst) begin
                dsp_data_out_reg <= 0;
            end else begin
                dsp_data_out_reg <= p_delay;
            end
        end else begin : gen_low_lane_output
            xu_priv::dsp_output dsp_data_out_reg1;

            always_ff @(posedge fab_out_clk)
            if (fab_out_rst) begin
                dsp_data_out_reg <= 0;
                dsp_data_out_reg1 <= 0;
            end else begin
                dsp_data_out_reg <= dsp_data_out_reg1;
                dsp_data_out_reg1 <= dsp_data_out;
            end
        end
    endgenerate

    always_ff @(posedge fab_out_clk)
    if (fab_out_rst) begin
        alu_mode_reg <= '{default:2'b0};
        for (int i = 0; i < LANE_LATENCY; i++) begin
            alu_mode_reg[i] <= alu_ctl.mode;
        end
    end else begin
        // alu_mode_reg <= {alu_mode_reg[LANE_LATENCY-2:0], alu_ctl.mode};
        for (int i = LANE_LATENCY-1; i > 0; i--) begin
            alu_mode_reg[i] <= alu_mode_reg[i-1];
        end
        alu_mode_reg[0] <= alu_ctl.mode;
    end

    // Connect outputs
    // FIXME(kevin): Need to manually optimize mux tree here
    logic [17:0] Y1_out;
    logic [17:0] Y2_out;
    logic [17:0] Y1_r1, Y2_r1;
    always_comb case (alu_mode_reg[LANE_LATENCY-2])
        2'b00: begin
            Y1_out = mode1_Y1;
            Y2_out = mode1_Y2;
        end
        2'b01: begin
            Y1_out = mode2_Y1;
            Y2_out = '0;
        end
        2'b10: begin
            Y1_out = mode3_Y1;
            Y2_out = mode3_Y2;
        end
        2'b11: begin
            Y1_out = '0;
            Y2_out = mode4_Y2;
        end
    endcase

    always_ff @( posedge fab_out_clk ) begin
    if (fab_out_rst) begin
        Y1 <= 0;
        Y2 <= 0;
        Y1_r1 <= 0;
        Y2_r1 <= 0;
    end else begin
        Y1 <= Y1_r1;
        Y2 <= Y2_r1;
        Y1_r1 <= Y1_out;
        Y2_r1 <= Y2_out;  
    end
    end

    // Instantiate DSP wrapper
    alu_dsp_wrapper alu_dsp_wrapper_inst (
        .clk(dsp_clk),
        .rst(dsp_rst),
        .dsp_data_in(dsp_data_in_reg),
        .dsp_control(dsp_control_muxed),
        .dsp_casc_in(dsp_casc_in),
        .dsp_casc_out(dsp_casc_out),
        .dsp_data_out(dsp_data_out)
    );

    // Check parameter legality
    // generate begin : parameter_checks
    //     if (FXP24_LOC <= 0 || FXP24_LOC > 23) begin
    //         $error("FXP24_LOC parameter out of range (0-23)");
    //     end
    //     if (FXP18_LOC <= 0 || FXP18_LOC > 17) begin
    //         $error("FXP18_LOC parameter out of range (0-17)");
    //     end
    //     if (LERP_FXP18_LOC <= 0 || LERP_FXP18_LOC > 17) begin
    //         $error("LERP_FXP18_LOC parameter out of range (0-17)");
    //     end
    // end : parameter_checks
    // endgenerate
    initial begin
        if (FXP24_LOC <= 0 || FXP24_LOC > 23) begin
            $error("FXP24_LOC parameter out of range (0-23)");
        end
        if (FXP18_LOC <= 0 || FXP18_LOC > 17) begin
            $error("FXP18_LOC parameter out of range (0-17)");
        end
        if (LERP_FXP18_LOC <= 0 || LERP_FXP18_LOC > 17) begin
            $error("LERP_FXP18_LOC parameter out of range (0-17)");
        end
    end

endmodule

`default_nettype wire
