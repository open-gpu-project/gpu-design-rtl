`default_nettype none

module lane_input_logic #() (
    input logic clk,
    input logic rst,
    input logic [35:0] pA,
    input logic [35:0] pB,
    output logic [23:0] l0x1,
    output logic [17:0] l0x2,
    output logic [23:0] l1x1,
    output logic [17:0] l1x2,
    input logic [1:0] mode,
    input logic mode1_sel_low,
    input logic [1:0] slice_sel_24bit
);

logic [35:0] pA_d1, pB_d1;
logic [17:0]  pA_d2_18lo, pB_d2_18lo;

function automatic logic [23:0] sign_extend_18b(input logic [17:0] value);
    sign_extend_18b = {{6{value[17]}}, value};
endfunction

function automatic logic [17:0] sign_extend_mode4_upper(input logic [23:0] value);
    sign_extend_mode4_upper = {{11{value[23]}}, value[23:17]};
endfunction

function automatic logic [23:0] zero_extend_18b(input logic [17:0] value);
    zero_extend_18b = {{6{1'b0}}, value};
endfunction

always_ff @( posedge clk ) begin
    if (rst) begin
        pA_d1 <= 36'b0;
        pB_d1 <= 36'b0;
        pA_d2_18lo <= 18'b0;
        pB_d2_18lo <= 18'b0;
    end else begin
        pA_d1 <= pA;
        pB_d1 <= pB;
        pA_d2_18lo <= pA_d1[17:0];
        pB_d2_18lo <= pB_d1[17:0];
    end
end

wire [17:0] pA_d1_18lo, pA_d1_18hi, pB_d1_18lo, pB_d1_18hi;
wire [17:0] pA_18lo, pA_18hi, pB_18lo, pB_18hi;

assign pA_d1_18lo = pA_d1[17:0];
assign pA_d1_18hi = pA_d1[35:18];
assign pB_d1_18lo = pB_d1[17:0];
assign pB_d1_18hi = pB_d1[35:18];

assign pA_18lo = pA[17:0];
assign pA_18hi = pA[35:18];
assign pB_18lo = pB[17:0];
assign pB_18hi = pB[35:18];

wire [23:0] slice1_24b, slice2_24b, slice3_24b;
assign slice1_24b = {pA_d1[35:12]};
assign slice2_24b = {pA_d1[11:0],pB_d1[11:0]};
assign slice3_24b = {pB_d1[35:12]};

always_comb begin
    unique case (mode)
        2'b00: begin
            l0x1 = zero_extend_18b(pA_d1_18hi);
            l0x2 = pA_d1_18lo;
            l1x1 = zero_extend_18b(pB_d1_18hi);
            l1x2 = pB_d1_18lo;
        end
        2'b01: begin
            if (mode1_sel_low) begin
                l0x1 = sign_extend_18b(pA_d2_18lo);
                l0x2 = pA_d1_18lo;
                l1x1 = sign_extend_18b(pB_d2_18lo);
                l1x2 = pB_d1_18lo;
            end else begin
                l0x1 = sign_extend_18b(pA_d1_18hi);
                l0x2 = pA_18hi;
                l1x1 = sign_extend_18b(pB_d1_18hi);
                l1x2 = pB_18hi;
            end
        end
        2'b10: begin
            unique case (slice_sel_24bit)
                0: begin
                    l0x1 = {{18{1'b0}},slice1_24b[23:18]};
                    l0x2 = slice1_24b[17:0];
                    l1x1 = {{18{1'b0}},slice2_24b[23:18]};
                    l1x2 = slice2_24b[17:0];
                end 
                1: begin
                    l0x1 = {{18{1'b0}},slice2_24b[23:18]};
                    l0x2 = slice2_24b[17:0];
                    l1x1 = {{18{1'b0}},slice3_24b[23:18]};
                    l1x2 = slice3_24b[17:0];
                end
                2: begin
                    l0x1 = {{18{1'b0}},slice3_24b[23:18]};
                    l0x2 = slice3_24b[17:0];
                    l1x1 = {{18{1'b0}},slice1_24b[23:18]};
                    l1x2 = slice1_24b[17:0];
                end
                default: begin
                    l0x1 = 24'hx;
                    l0x2 = 18'hx;
                    l1x1 = 24'hx;
                    l1x2 = 18'hx;
                end
            endcase
        end
        2'b11: begin
            unique case (slice_sel_24bit)
                0: begin
                    l0x1 = slice1_24b;                          // 24bit a
                    l0x2 = sign_extend_mode4_upper(slice2_24b); // upper 7bit b sign extended
                    l1x1 = slice1_24b;                          // 24bit a
                    l1x2 = slice2_24b[17:0];                    // lower 17bit b
                end 
                1: begin
                    l0x1 = slice2_24b;
                    l0x2 = sign_extend_mode4_upper(slice3_24b);
                    l1x1 = slice2_24b;
                    l1x2 = slice3_24b[17:0];
                end
                2: begin
                    l0x1 = slice3_24b;
                    l0x2 = sign_extend_mode4_upper(slice1_24b);
                    l1x1 = slice3_24b;
                    l1x2 = slice1_24b[17:0];
                end
                default: begin
                    l0x1 = 24'hx;
                    l0x2 = 18'hx;
                    l1x1 = 24'hx;
                    l1x2 = 18'hx;
                end
            endcase
        end
        default: begin
            l0x1 = 24'hx;
            l0x2 = 18'hx;
            l1x1 = 24'hx;
            l1x2 = 18'hx;
        end
    endcase
end
    
endmodule
