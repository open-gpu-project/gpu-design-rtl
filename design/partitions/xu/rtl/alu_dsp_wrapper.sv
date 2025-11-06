module alu_dsp_wrapper(
    input logic clk
);

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
        .SEL_MASK("C"),
        .SEL_PATTERN("C"),
        .USE_PATTERN_DETECT("PATDET")
    ) dsp_inst (

    );

endmodule
