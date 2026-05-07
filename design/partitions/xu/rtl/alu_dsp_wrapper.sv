`default_nettype none
`timescale 1ns/1ns
`include "xu_priv.svh"

module alu_dsp_wrapper(
    input logic clk,
    input logic rst,

    input   xu_priv::dsp_input      dsp_data_in,
    input   xu_priv::dsp_ctl        dsp_control,
    input   xu_priv::dsp_casc_in    dsp_casc_in,
    output  xu_priv::dsp_casc_out   dsp_casc_out,
    output  xu_priv::dsp_output     dsp_data_out
);

    // Unused outputs
    // verilator lint_off UNUSEDSIGNAL
    logic [29:0] ACOUT;
    logic [17:0] BCOUT;
    logic OVERFLOW;
    logic UNDERFLOW;
    logic[3:0] CARRYOUT;
    // verilator lint_on UNUSEDSIGNAL

    // Wrap DSP48E1 primitive using the defined structs for clarity.
    // Also pre-configure the DSP48E1 attributes for our use case.
    DSP48E1 #(
        // Register Control Attributes
        .ACASCREG(1),
        .ADREG(1),
        .ALUMODEREG(1),
        .AREG(2), // Can dynamically MUX between 1 and 2
        .BCASCREG(1),
        .BREG(2), // Can dynamically MUX between 1 and 2
        .CARRYINREG(1),
        .CARRYINSELREG(1),
        .CREG(1),
        .DREG(1),
        .INMODEREG(1),
        .MREG(1),
        .OPMODEREG(1),
        .PREG(1),

        // Feature Control Attributes
        .A_INPUT("DIRECT"),
        .B_INPUT("DIRECT"),
        .USE_DPORT("TRUE"),
        .USE_MULT("DYNAMIC"),
        .USE_SIMD("ONE48"),

        // Pattern Detector Attributes
        .AUTORESET_PATDET("NO_RESET"),
        .MASK(48'h0003_FFFF),
        .PATTERN(48'h0),
        .SEL_MASK("MASK"),
        .SEL_PATTERN("C"),
        .USE_PATTERN_DETECT("PATDET")
    ) dsp_inst (
        // Clock and Reset
        .CLK(clk),
        .RSTA(rst),
        .RSTB(rst),
        .RSTC(rst),
        .RSTD(rst),
        .RSTM(rst),
        .RSTP(rst),
        .RSTALLCARRYIN(rst),
        .RSTALUMODE(rst),
        .RSTCTRL(rst),
        .RSTINMODE(rst),

        // Data inputs
        .A(dsp_data_in.A),
        .B(dsp_data_in.B),
        .C(dsp_data_in.C),
        .D(dsp_data_in.D),

        // Carry inputs
        .CARRYIN(0),
        .CARRYOUT(CARRYOUT),
        .CARRYINSEL(0),

        // Control inputs
        .INMODE(dsp_control.INMODE),
        .OPMODE(dsp_control.OPMODE),
        .ALUMODE(dsp_control.ALUMODE),

        // Clock enables
        .CEA1(dsp_control.CEA[0]),
        .CEA2(dsp_control.CEA[1]),
        .CEB1(dsp_control.CEB[0]),
        .CEB2(dsp_control.CEB[1]),
        .CEC(dsp_control.CEC),
        .CED(dsp_control.CED),
        .CEM(dsp_control.CEM),
        .CEP(dsp_control.CEP),
        .CEAD(dsp_control.CEAD),
        .CECARRYIN(1'b1),
        .CEALUMODE(1'b1),
        .CECTRL(1'b1),
        .CEINMODE(1'b1),

        // Cascade paths
        .ACIN(0),
        .ACOUT(ACOUT),
        .BCIN(0),
        .BCOUT(BCOUT),
        .PCIN(dsp_casc_in.PCIN),
        .PCOUT(dsp_casc_out.PCOUT),
        .MULTSIGNIN(dsp_casc_in.MULTSIGNIN),
        .MULTSIGNOUT(dsp_casc_out.MULTSIGNOUT),
        .CARRYCASCIN(dsp_casc_in.CARRYCASCIN),
        .CARRYCASCOUT(dsp_casc_out.CARRYCASCOUT),

        // Data outputs
        .P(dsp_data_out.P),
        .OVERFLOW(OVERFLOW),
        .UNDERFLOW(UNDERFLOW),
        .PATTERNDETECT(dsp_data_out.PATTERNDETECT),
        .PATTERNBDETECT(dsp_data_out.PATTERNBDETECT)
    );
endmodule

`default_nettype wire
