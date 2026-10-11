`default_nettype none

module lane_output_logic (
    input logic fab_out_clk,

    input xu_priv::alu_mode_t mode,

    input logic [17:0] l0y1,
    input logic [17:0] l0y2,
    input logic [17:0] l1y1,
    input logic [17:0] l1y2,

    output logic [35:0] l0_result,
    output logic [35:0] l1_result
);

always_comb begin
    case (mode)
        xu_priv::ADD18, xu_priv::CMP18: begin
            l0_result = {l0y1, l0y2};
            l1_result = {l1y1, l1y2};
        end
        xu_priv::FMA18: begin
            // FMA result is on y1. top.sv routes result[17:0] to the high or
            // low accumulator bank selected by the delayed mode1_sel_low.
            l0_result = {18'b0, l0y1};
            l1_result = {18'b0, l1y1};
        end
        xu_priv::ADD24, xu_priv::CMP24: begin
            l0_result = {l0y1, l0y2};
            l1_result = {l1y1, l1y2};
        end
        xu_priv::FMA24: begin
            // High lane exposes P[23:9] on Y2, low lane P[8:0] on Y2 (Y1 is 0 in mode 3).
            // l0acc also gets the result so a following 24-bit op can consume it from either lane.
            l0_result = {12'b0, l0y2[14:0], l1y2[8:0]};
            l1_result = {12'b0, l0y2[14:0], l1y2[8:0]};
        end
        default: begin
            $error("Invalid mode for lane output logic: %0d", mode);
            l0_result = 36'bx;
            l1_result = 36'bx;
        end
	    endcase
	end

endmodule
