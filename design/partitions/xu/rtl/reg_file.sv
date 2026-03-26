module reg_file (
    input  logic        clk,
    input  logic        rst,

    input  logic [9:0]  addr_a,
    input  logic        en_a,
    input  logic        we_a,
    input  logic [35:0] wdata_a,
    output logic [35:0] rdata_a,

    input  logic [9:0]  addr_b,
    input  logic        en_b,
    input  logic        we_b,
    input  logic [35:0] wdata_b,
    output logic [35:0] rdata_b
);

    bram_wrapper u_bram (
        .clk   (clk),
        .rst   (rst),

        .ADDR_A(addr_a),
        .EN_A  (en_a),
        .WE_A  (we_a),
        .DI_A  (wdata_a),
        .DO_A  (rdata_a),

        .ADDR_B(addr_b),
        .EN_B  (en_b),
        .WE_B  (we_b),
        .DI_B  (wdata_b),
        .DO_B  (rdata_b)
    );

endmodule