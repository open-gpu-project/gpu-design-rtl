`default_nettype none

module xu_ctl_delay_tap (
    input xu_priv::xu_ctl xu_ctl_in,
    input logic clk,
    input logic rst,
    input logic ce,
    output xu_priv::xu_ctl xu_ctl_taps_out [7:0]
);

localparam int DELAY = 8;
xu_priv::xu_ctl ctl_delay_tap [7:0];

always_ff @(posedge clk) begin
    if (rst) begin
        for (int i = 0; i < DELAY; i++) begin
            ctl_delay_tap[i] <= '0;
        end
    end else if (ce) begin
        ctl_delay_tap[0] <= xu_ctl_in;

        for (int i = 1; i < DELAY; i++) begin
            ctl_delay_tap[i] <= ctl_delay_tap[i-1];
        end
    end
end

assign xu_ctl_taps_out = ctl_delay_tap;
    
endmodule