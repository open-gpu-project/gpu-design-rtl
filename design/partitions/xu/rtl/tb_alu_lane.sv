`timescale 1ns/1ps
`default_nettype none
`include "xu_priv.svh"

module tb_alu_lane;
    logic clk;
    logic rst;

    // logic [29:0] A;
    // logic [17:0] B;
    // logic [47:0] C;
    // logic [24:0] D;
    // xu_priv::dsp_input dsp_data_in;
    // assign dsp_data_in.A = A;
    // assign dsp_data_in.B = B;
    // assign dsp_data_in.C = C;
    // assign dsp_data_in.D = D;

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

    // logic[47:0] P;
    // logic PATTERNDETECT;
    // logic PATTERNBDETECT;    
    // xu_priv::dsp_output dsp_data_out;
    // assign P = dsp_data_out.P;
    // assign PATTERNDETECT = dsp_data_out.PATTERNDETECT;
    // assign PATTERNBDETECT = dsp_data_out.PATTERNBDETECT;

     // Hold value for testing clock enables

    logic [47:0] p_hold;

    xu_priv::alu_lane_ctl alu_mode = 2'b00; // Default to mode 0
    logic [23:0] X1;
    logic [17:0] AccIn1;
    logic [17:0] X2;
    logic [17:0] AccIn2;
    logic [17:0] Y1;
    logic [17:0] Y2;

    alu_lane dut(
       .dsp_clk      (clk      ),
       .dsp_rst      (rst      ),
       .fab_in_clk   (clk   ),
       .fab_in_rst   (rst   ),
       .fab_out_clk  (clk  ),
       .fab_out_rst  (rst  ),
       .alu_ctl      (alu_mode      ),
       .X1           (X1           ),
       .AccIn1       (AccIn1       ),
       .X2           (X2           ),
       .AccIn2       (AccIn2       ),
       .dsp_control  (dsp_control  ),
       .dsp_casc_in  (dsp_casc_in  ),
       .dsp_casc_out (dsp_casc_out ),
       .Y1           (Y1           ),
       .Y2           (Y2           )
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    task automatic tick_and_show(input string tag);
        begin
            @(posedge clk);
            #1;
            $display("[%0t] %s | Y1=%h Y2=%h OPMODE=%b ALUMODE=%b INMODE=%b CEA=%b CEB=%b CEC=%b CED=%b CEAD=%b CEP=%b",
                $time, tag, Y1, Y2,
                dsp_control.OPMODE, dsp_control.ALUMODE, dsp_control.INMODE,
                dsp_control.CEA, dsp_control.CEB,
                dsp_control.CEC, dsp_control.CED, dsp_control.CEAD, dsp_control.CEP);
        end
    endtask

    initial begin
        $dumpfile("out/tb_alu_lane.vcd");
        $dumpvars(0, tb_alu_lane);

        rst = 1'b1;
        // X1 = '0;
        // X2 = '0;
        // AccIn1 = '0;
        // AccIn2 = '0;
        PCIN = '0;
        MULTSIGNIN = 1'b0;
        CARRYCASCIN = 1'b0;
        // INMODE = '0;
        // ALUMODE = '0;
        // OPMODE = '0;
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
        // A <= {6'b0,{18'h1111},6'b0};
        // B <= 18'h0_4444;
        // C <= {{6'b0},{18'h2222},{6'b0},{18'h2222}};
        // // C <= 0;
        // D <= 25'd0;

        X1<= 24'h00_0000;
        X2 <= 18'h0_0000;
        AccIn1 <= 18'h00001;
        AccIn2 <= 18'h00001;
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        X1<= 24'h00_0001;
        X2 <= 18'h0_0002;
        AccIn1 <= 18'h00000;
        AccIn2 <= 18'h00000;
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");
        tick_and_show("");

        X1 <= 24'h00_1111;
        X2 <= 18'h0_2222;
        AccIn1 <= 18'h01010;
        AccIn2 <= 18'h00101;

        // tick_and_show("baseline add");

        tick_and_show("1");

        X1 <= 24'h00_2222;
        X2 <= 18'h0_3333;
        AccIn1 <= 18'h01010;
        AccIn2 <= 18'h00101;

        tick_and_show("2");

        X1 <= 24'h00_3333;
        X2 <= 18'h0_4444;
        AccIn1 <= 18'h01010;
        AccIn2 <= 18'h00101;

        tick_and_show("3");

        X1 <= 24'h00_4444;
        X2 <= 18'h0_5555;
        AccIn1 <= 18'h01010;
        AccIn2 <= 18'h00101;

        tick_and_show("4");

        X1 <= 24'h00_5555;
        X2 <= 18'h0_6666;
        AccIn1 <= 18'h01010;
        AccIn2 <= 18'h00101;

        tick_and_show("5");     
        tick_and_show("6");
        tick_and_show("7");
        tick_and_show("8");
        tick_and_show("9");
        tick_and_show("10");

        // Mode 2
        rst = 1'b1;
        alu_mode.mode <= 2'b01; // Switch to mode 2 for 18b multiplication + addition
        OPMODE <= 7'b011_0101;
        ALUMODE <= 4'b0000;
        INMODE <= 5'b00000;
        X1 <= 24'h00_0000;
        X2 <= 18'h0_0000;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00000;   

        repeat (2) @(posedge clk);
        rst = 1'b0;

        tick_and_show("14");
        tick_and_show("15");
        tick_and_show("16");
        tick_and_show("17");
        tick_and_show("18");
        tick_and_show("19");
        tick_and_show("20");
        tick_and_show("21");
        tick_and_show("22");
        tick_and_show("23");

        X1 <= 24'h00_0100;
        X2 <= 18'h0_0200;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00000;   
        tick_and_show("11");

        // X1 <= 24'h00_0200;
        // X2 <= 18'h0_0300;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00100;     
        tick_and_show("12");

        X1 <= 24'h00_0300;
        X2 <= 18'h0_0400;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00100; 
        tick_and_show("13");

        X1 <= 24'h00_FF00;
        X2 <= 18'h0_0200;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00100; 
        tick_and_show("14");
        tick_and_show("15");
        tick_and_show("16");
        tick_and_show("17");
        tick_and_show("18");
        tick_and_show("19");
        tick_and_show("20");
        tick_and_show("21");
        tick_and_show("22");
        tick_and_show("23");

        rst = 1'b1;
        alu_mode.mode <= 2'b10; // Switch to mode 3 for 24b addition
        OPMODE <= 7'b000_1111;
        ALUMODE <= 4'b0000;
        INMODE <= 5'b00000;
        X1 <= 24'h00_0000;
        X2 <= 18'h0_0000;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00000;   

        repeat (2) @(posedge clk);
        rst = 1'b0;
        X1 <= 24'h00_0000;
        X2 <= 18'h0_0200;
        AccIn1 <= 18'h00000; //unused
        AccIn2 <= 18'h00100;   
        tick_and_show("24");
        tick_and_show("25");
        tick_and_show("26");
        tick_and_show("27");
        tick_and_show("28");
        tick_and_show("29");
        tick_and_show("30");
        $finish;
    end
endmodule

`default_nettype wire