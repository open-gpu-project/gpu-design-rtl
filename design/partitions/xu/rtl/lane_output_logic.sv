`default_nettype none

module lane_output_logic (
    input logic fab_out_clk,

    input logic [1:0] mode,

    input logic [17:0] l0y1,
    input logic [17:0] l0y2,
    input logic [17:0] l1y1,
    input logic [17:0] l1y2,

    output logic [35:0] l0acc_in,
    output logic [35:0] l1acc_in
);

always_comb begin
    case (mode)
        2'b00: begin
            l0acc_in = {l0y1, l0y2};
            l1acc_in = {l1y1, l1y2};
        end
        2'b01: begin
            l0acc_in = {l0y2, l0y1};
            l1acc_in = {l1y1, l1y2};
        end
        2'b10: begin
            l0acc_in = {l0y1, l0y2};
            l1acc_in = {l1y1, l1y2};
        end
        2'b11: begin
            l0acc_in = {12'b0, l0y1[14:0], l1y2[8:0]}; // l0acc also gets result from fma for 24bit addition use, does not affect fma calculation even if set to any value
            l1acc_in = {12'b0, l0y1[14:0], l1y2[8:0]};
        end
	    endcase
	end

endmodule
