`timescale 1ns/1ps
`default_nettype none
`include "xu_priv.svh"

module tb_alu_dsp_wrapper;
    logic clk;
    logic rst;

    logic [29:0] A;
    logic [17:0] B;
    logic [47:0] C;
    logic [24:0] D;
    xu_priv::dsp_input dsp_data_in;
    assign dsp_data_in.A = A;
    assign dsp_data_in.B = B;
    assign dsp_data_in.C = C;
    assign dsp_data_in.D = D;

    logic[4:0] INMODE;
    logic[3:0] ALUMODE;
    logic[6:0] OPMODE;
    logic[1:0] CEA;
    logic[1:0] CEB;
    logic CEC;
    logic CED;
    logic CEM;
    logic CEP;
    logic CEAD;
    xu_priv::dsp_ctl dsp_control;
    assign dsp_control.INMODE = INMODE;
    assign dsp_control.ALUMODE = ALUMODE;
    assign dsp_control.OPMODE = OPMODE;
    assign dsp_control.CEA = CEA;
    assign dsp_control.CEB = CEB;
    assign dsp_control.CEC = CEC;
    assign dsp_control.CED = CED;
    assign dsp_control.CEM = CEM;
    assign dsp_control.CEP = CEP;
    assign dsp_control.CEAD = CEAD;

    logic[47:0] PCIN;
    logic MULTSIGNIN;
    logic CARRYCASCIN;
    xu_priv::dsp_casc_in dsp_casc_in;
    assign dsp_casc_in.PCIN = PCIN;
    assign dsp_casc_in.MULTSIGNIN = MULTSIGNIN;
    assign dsp_casc_in.CARRYCASCIN = CARRYCASCIN;

    logic[47:0] PCOUT;
    logic MULTSIGNOUT;
    logic CARRYCASCOUT;   
    xu_priv::dsp_casc_out dsp_casc_out;
    assign PCOUT = dsp_casc_out.PCOUT;
    assign MULTSIGNOUT = dsp_casc_out.MULTSIGNOUT;
    assign CARRYCASCOUT = dsp_casc_out.CARRYCASCOUT;

    logic[47:0] P;
    logic PATTERNDETECT;
    logic PATTERNBDETECT;    
    xu_priv::dsp_output dsp_data_out;
    assign P = dsp_data_out.P;
    assign PATTERNDETECT = dsp_data_out.PATTERNDETECT;
    assign PATTERNBDETECT = dsp_data_out.PATTERNBDETECT;

     // Hold value for testing clock enables

    logic [47:0] p_hold;

    alu_dsp_wrapper dut (
        .clk(clk),
        .rst(rst),
        .dsp_data_in(dsp_data_in),
        .dsp_control(dsp_control),
        .dsp_casc_in(dsp_casc_in),
        .dsp_casc_out(dsp_casc_out),
        .dsp_data_out(dsp_data_out)
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    task automatic tick_and_show(input string tag);
        begin
            @(posedge clk);
            #1;
            $display("[%0t] %s | P=%h OPMODE=%b ALUMODE=%b INMODE=%b CEA=%b CEB=%b CEC=%b CED=%b CEAD=%b CEP=%b",
                $time, tag, dsp_data_out.P,
                dsp_control.OPMODE, dsp_control.ALUMODE, dsp_control.INMODE,
                dsp_control.CEA, dsp_control.CEB,
                dsp_control.CEC, dsp_control.CED, dsp_control.CEAD, dsp_control.CEP);
        end
    endtask

    initial begin
        $dumpfile("out/tb_alu_dsp_wrapper.vcd");
        $dumpvars(0, tb_alu_dsp_wrapper);

        rst = 1'b1;
        // dsp_data_in = '0;
        // dsp_control = '0;
        // dsp_casc_in = '0;

        // Enable all relevant control clocks for baseline behavior.
        CEA = 2'b11;
        CEB = 2'b11;
        CEC = 1'b1;
        CED = 1'b1;
        CEM = 1'b1;
        CEP = 1'b1;
        CEAD = 1'b1;

        repeat (2) @(posedge clk);
        rst <= 1'b0;

        // Mode 1 18b inputs, simple add: P = A + B + Acc
        OPMODE <= 7'b000_1111;
        ALUMODE <= 4'b0000;
        INMODE <= 5'b00000;
        A <= {6'b0,{18'h1111},6'b0};
        B <= 18'h0_4444;
        C <= {{6'b0},{18'h2222},{6'b0},{18'h2222}};
        // C <= 0;
        D <= 25'd0;
        // tick_and_show("baseline add");

        tick_and_show("1");
        tick_and_show("2");
        tick_and_show("3");
        tick_and_show("4");
        tick_and_show("5");
        tick_and_show("6");

        // Mode 2 
        OPMODE <= 7'b011_0101;
        ALUMODE <= 4'b0000;
        INMODE <= 5'b00000;
        A <= {30'h00000002};
        B <= 18'h0_0003;
        C <= 48'h0000_0000_0004;
        D <= 25'd0;
        tick_and_show("1");
        tick_and_show("2");
        tick_and_show("3");
        tick_and_show("4");
        tick_and_show("5");
        tick_and_show("6");
        // // Change ALUMODE -> XOR behavior.
        // ALUMODE <= 4'b0100;
        // tick_and_show("alumode xor");

        // // Change OPMODE -> use Z only before ALU stage.
        // OPMODE <= 7'b0000000;
        // ALUMODE <= 4'b0000;
        // tick_and_show("opmode z-only");

        // // Demonstrate INMODE effect: include D in X term.
        // OPMODE <= 7'b0000001;
        // INMODE <= 5'b00001;
        // tick_and_show("inmode uses D");

        // // Demonstrate CEP gating: hold P while inputs keep changing.
        // p_hold = P;
        // CEP <= 1'b0;
        // A <= 30'd77;
        // B <= 18'd55;
        // C <= 48'd99;
        // D <= 25'd11;
        // tick_and_show("CEP=0 hold P");
        // // if (dsp_data_out.P !== p_hold) begin
        // //     $display("FAIL: P changed while CEP=0");
        // //     $finish;
        // // end

        // // Re-enable P update.
        // CEP <= 1'b1;
        // tick_and_show("CEP=1 update P");
        // // if (dsp_data_out.P === p_hold) begin
        // //     $display("FAIL: P did not update after CEP=1");
        // //     $finish;
        // // end

        // // Demonstrate CEA/CEB/CEC/CED hold behavior.
        // p_hold = P;
        // CEA <= 2'b00;
        // CEB <= 2'b00;
        // CEC <= 1'b0;
        // CED <= 1'b0;
        // CEAD <= 1'b0;
        // A <= 30'd999;
        // B <= 18'd888;
        // C <= 48'd777;
        // D <= 25'd666;
        // tick_and_show("data CEs low hold regs");
        // // if (dsp_data_out.P !== p_hold) begin
        // //     $display("FAIL: P changed while data register CEs were low");
        // //     $finish;
        // // end

        // // $display("DSP WRAPPER CONTROL-SIGNAL TEST PASSED");
        $finish;
    end
endmodule

`default_nettype wire
