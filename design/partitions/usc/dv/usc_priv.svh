`ifdef INCLUDE_USC_PRIV_SVH
`else
`define INCLUDE_USC_PRIV_SVH

package usc_priv;

    typedef struct packed {
        logic [1:0] packet_type;
        logic       gce;
        logic [1:0] usc;
        logic [3:0] opcode;
        logic [6:0] src0;
        logic [6:0] src1;
        logic [6:0] dst;
        logic [17:0] imm;
    } instruction_t;

endpackage;

`endif // INCLUDE_USC_PRIV_SVH
