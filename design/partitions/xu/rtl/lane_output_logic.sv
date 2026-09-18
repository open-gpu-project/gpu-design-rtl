`default_nettype none

module lane_output_logic (
    input logic fab_out_clk,

    input logic [1:0] mode,

    input logic [17:0] l0y1,
    input logic [17:0] l0y2,
    input logic [17:0] l1y1,
    input logic [17:0] l1y2,

    output logic [35:0] l0_result,
    output logic [35:0] l1_result
);

always_comb begin
    case (mode)
        2'b00: begin
            l0_result = {l0y1, l0y2};
            l1_result = {l1y1, l1y2};
        end
        2'b01: begin
            // FMA result is on y1. top.sv routes result[17:0] to the high or
            // low accumulator bank selected by the delayed mode1_sel_low.
            l0_result = {18'b0, l0y1};
            l1_result = {18'b0, l1y1};
        end
        2'b10: begin
            l0_result = {l0y1, l0y2};
            l1_result = {l1y1, l1y2};
        end
        2'b11: begin
            // High lane exposes P[23:9] on Y2, low lane P[8:0] on Y2 (Y1 is 0 in mode 3).
            // l0acc also gets the result so a following 24-bit op can consume it from either lane.
            l0_result = {12'b0, l0y2[14:0], l1y2[8:0]};
            l1_result = {12'b0, l0y2[14:0], l1y2[8:0]};
        end
	    endcase
	end

endmodule
