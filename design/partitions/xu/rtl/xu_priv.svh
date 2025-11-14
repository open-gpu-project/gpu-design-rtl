`ifdef INCLUDE_XU_PRIV_SVH
`else
`define INCLUDE_XU_PRIV_SVH

package xu_priv;

    typedef struct packed {
        logic[29:0] A;
        logic[17:0] B;
        logic[47:0] C;
        logic[24:0] D;
    } dsp_input;

    typedef struct packed {
        logic[47:0] P;
        logic PATTERNDETECT;
        logic PATTERNBDETECT;
    } dsp_output;

    typedef struct packed {
        logic[4:0] INMODE;
        logic[3:0] ALUMODE;
        logic[6:0] OPMODE;
        logic[1:0] CEA;
        logic[1:0] CEB;
        logic CEC;
        logic CED;
        logic CEM;
        logic CEP;
        logic CEAD;
    } dsp_ctl;

    typedef struct packed {
        logic[47:0] PCIN;
        logic MULTSIGNIN;
        logic CARRYCASCIN;
    } dsp_casc_in;

    typedef struct packed {
        logic[47:0] PCOUT;
        logic MULTSIGNOUT;
        logic CARRYCASCOUT;
    } dsp_casc_out;

    typedef struct packed {
        logic[1:0] mode;
    } alu_lane_ctl;

endpackage;

`endif // INCLUDE_XU_PRIV_SVH
