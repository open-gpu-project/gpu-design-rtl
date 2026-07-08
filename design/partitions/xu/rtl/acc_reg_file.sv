`default_nettype none

// Accumulator register file, one per ALU lane.
//
// Async read + sync write on an unreset array is the canonical idiom for
// SLICEM distributed-RAM (RAM32X1D / RAM32M) inference, replacing the
// previous SRLC32E delay line with random-access slot semantics.
// Contents are undefined until written; the DV assembler guarantees
// write-before-read.
module acc_reg_file #(
    parameter int WIDTH = 36,
    parameter int DEPTH = 32,
    localparam int AW = $clog2(DEPTH)
) (
    input logic clk,

    input logic we,
    input logic [AW-1:0] waddr,
    input logic [WIDTH-1:0] wdata,

    input logic [AW-1:0] raddr,
    output logic [WIDTH-1:0] rdata
);

(* ram_style = "distributed" *) logic [WIDTH-1:0] mem [DEPTH];

assign rdata = mem[raddr];

always_ff @(posedge clk) begin
    if (we) begin
        mem[waddr] <= wdata;
    end
end

endmodule
