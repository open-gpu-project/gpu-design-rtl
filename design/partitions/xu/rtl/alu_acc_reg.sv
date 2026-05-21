`default_nettype none

module alu_acc_reg #(
    parameter int WIDTH = 36
) (
    input logic clk,
    input logic rst,
    input logic ce,
    input logic [WIDTH-1:0] d,
    output logic [WIDTH-1:0] q,
    input logic [3:0] depth
);

wire [3:0] ADDR = 4'(depth - 1);

genvar i;
generate
    for (i = 0; i < WIDTH; i++) begin : gen_srl
        SRL16E 
        #(
            .INIT (16'b0 )
        )
        u_SRL16E(
            .Q   (q[i]   ),
            .A0  (ADDR[0]  ),
            .A1  (ADDR[1]  ),
            .A2  (ADDR[2]  ),
            .A3  (ADDR[3]  ),
            .CE  (ce  ),
            .CLK (clk ),
            .D   (d[i]   )
        );
    end
endgenerate

endmodule

`default_nettype wire
