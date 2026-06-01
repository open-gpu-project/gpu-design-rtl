`default_nettype none

module alu_acc_reg #(
    parameter int WIDTH = 36
) (
    input logic clk,
    input logic rst,
    input logic ce,
    input logic [WIDTH-1:0] d,
    output logic [WIDTH-1:0] q,
    input logic [5:0] depth
);

always_comb begin
    assert (depth <= 32) 
        else   $error("Depth must be less than or equal to 32 for SRLC32E");
end


wire [4:0] ADDR = 5'(depth - 1);
wire [WIDTH-1:0] srl_q31_unused;

genvar i;
generate
    for (i = 0; i < WIDTH; i++) begin : gen_srl
        SRLC32E 
        #(
            .INIT (32'b0 )
        )
        u_SRLC32E(
            .Q   (q[i]   ),
            .Q31 (srl_q31_unused[i]),
            .A   (ADDR),
            .CE  (ce  ),
            .CLK (clk ),
            .D   (d[i]   )
        );
    end
endgenerate

endmodule

`default_nettype wire
