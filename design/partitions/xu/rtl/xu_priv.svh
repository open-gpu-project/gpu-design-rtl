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
        logic[17:0] X1;
        logic[17:0] X2;
        logic[17:0] AccIn1;
        logic[17:0] AccIn2;
    } alu_lane_input;

    typedef enum logic [2:0] {
        ADD18=0,
        FMA18=1,
        ADD24=2,
        FMA24=3,
        CMP18=4
    } alu_mode_t;

    typedef enum logic [2:0]{
        PRED_EQ=0,
        PRED_NE=1,
        PRED_LT=2,
        PRED_LE=3,
        PRED_GT=4,
        PRED_GE=5
    } pred_cond_t;

    typedef struct packed {
        alu_mode_t mode;
        dsp_ctl dsp_control;
    } alu_lane_ctl;

    typedef struct packed {
        logic[9:0] ADDR_A;
        logic EN_A;
        logic [3:0] WE_A;
        logic[9:0] ADDR_B;
        logic EN_B;
        logic [3:0] WE_B;
        dsp_ctl l0dsp_control;
        dsp_ctl l1dsp_control;
        alu_mode_t mode;
        logic [1:0] slice_sel_24bit;
        logic mode1_sel_low;
        logic [4:0] acc_raddr;
        logic [4:0] acc_waddr;
        logic acc_we;

        logic [4:0] pred_raddr;
        logic [4:0] pred_waddr;
        logic pred_we;
        logic pred_enable;
        logic pred_invert;
        pred_cond_t pred_cond;

        logic zero_bram_operands;

        logic l0_wb_valid;
        logic l1_wb_valid;
        logic [3:0] WB_WE_A;
        logic [3:0] WB_WE_B;
        logic [9:0] WB_ADDR_A;
        logic [9:0] WB_ADDR_B;
    } xu_ctl;

endpackage;

`endif // INCLUDE_XU_PRIV_SVH
