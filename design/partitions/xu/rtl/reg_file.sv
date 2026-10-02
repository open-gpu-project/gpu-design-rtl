`default_nettype none

module reg_file (
    input  logic        clk,
    input  logic        rst,

    input  logic [9:0]  addr_a,
    input  logic        en_a,
    input  logic        we_a,
    input  logic [35:0] wdata_a,
    output logic [35:0] rdata_a,
    output logic [23:0] rdata_a_24b,
    output logic [11:0] rdata_a_12b,
    output logic [17:0] rdata_a_18b_high,
    output logic [17:0] rdata_a_18b_low,

    input  logic [9:0]  addr_b,
    input  logic        en_b,
    input  logic        we_b,
    input  logic [35:0] wdata_b,
    output logic [35:0] rdata_b,
    output logic [23:0] rdata_b_24b,
    output logic [11:0] rdata_b_12b,
    output logic [17:0] rdata_b_18b_high,
    output logic [17:0] rdata_b_18b_low
);

    assign rdata_a_24b = rdata_a[35:12];
    assign rdata_a_12b = rdata_a[11:0];
    assign rdata_a_18b_high = rdata_a[35:18];
    assign rdata_a_18b_low = rdata_a[17:0];

    assign rdata_b_24b = rdata_b[35:12];
    assign rdata_b_12b = rdata_b[11:0];
    assign rdata_b_18b_high = rdata_b[35:18];
    assign rdata_b_18b_low = rdata_b[17:0];

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