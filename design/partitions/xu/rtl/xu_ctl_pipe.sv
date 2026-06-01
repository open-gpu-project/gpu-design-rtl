`default_nettype none

module xu_ctl_pipe (
    input xu_priv::xu_ctl xu_ctl_in,
    input logic clk,
    input logic rst,
    input logic ce,
    output xu_priv::xu_ctl xu_ctl_pipe_out [7:0]
);

localparam int DELAY = 8;
xu_priv::xu_ctl ctl_pipe [7:0];

always_ff @(posedge clk) begin
    if (rst) begin
        for (int i = 0; i < DELAY; i++) begin
            ctl_pipe[i] <= '0;
        end
    end else if (ce) begin
        ctl_pipe[0] <= xu_ctl_in;

        for (int i = 1; i < DELAY; i++) begin
            ctl_pipe[i] <= ctl_pipe[i-1];
        end
    end
end

assign xu_ctl_pipe_out = ctl_pipe;
    
endmodule