var serialport = require("serialport");
var SerialPort = serialport.SerialPort;
// localize object constructor
var sp = new SerialPort("COM17", {
	parser: serialport.parsers.raw,
	baudrate: 115200

});

// var address = 0xAA; // 0xAA 170 um6_get_fw_version
var PT_HAS_DATA = 0x80; // 0x80 10000000
var PT_IS_BATCH = 0x40; // 0x40 01000000
var PT_BATCH_LEN = 0x08; // 0x08 Batch length = 2
var PT_HASNO_DATA = 0x00;
var PT_ISNO_BATCH = 0x00;
var PT_NOBATCH_LEN = 0x00;

//Stellen vom PacketType Byte (von links her gelesen)
var PT_HAS_DATA_BINDIGIT = 0; // Has Data: If the packet containsdata, this bit is set (1). Ifnot, this bit is cleared (0).
var PT_IS_BATCH_BINDIGIT = 1; // Is Batch: If the packet is a batch operation, this bit is set (1). If not, this bit is cleared (0)
var PT_BL3_BINDIGIT = 2; // Batch Length (BL): Four bits specifying the length of the batch operation. Unused if bit 7
var PT_BL2_BINDIGIT = 3; // Batch Length (BL): Four bits specifying the length of the batch operation. Unused if bit 7
var PT_BL1_BINDIGIT = 4; // Batch Length (BL): Four bits specifying the length of the batch operation. Unused if bit 7
var PT_BL0_BINDIGIT = 5; // Batch Length (BL): Four bits specifying the length of the batch operation. Unused if bit 7
var PT_RES_BINDIGIT = 6; // Reserved
var PT_CF_BINDIGIT = 7; // Command Failed (CF): Used by the UM6 to report when a command has failed. Unused for packet sent to the UM6.
// liest alle Options aus dem PT aus  ####  erwartet einen String

function readPT(ptByte) {
	// Falls PT-Byte 0 ist, schreibt es für Binary-Darstellungen ein paar 0 dazu
	if(ptByte.length == 1 && ptByte[0] == 0) {
		ptByte = "00000000";
	} else if(ptByte.length < 8) {
		ptByte = "0" + ptByte; //Falls Links eine 0 fehlt diese auch dazuschreiben
	}
	// auslesen der PT-Byte Daten
	var pt = {
		pt_hasData: ptByte[PT_HAS_DATA_BINDIGIT],
		pt_is_batch: ptByte[PT_IS_BATCH_BINDIGIT],
		pt_bl: parseInt(ptByte.substr(2, 4), 2),
		pt_cf: ptByte[PT_CF_BINDIGIT]
	};
	return pt;
}

//überprüft ob die gesendeten Daten auch mit der gesendeten Checksumme übereinstimmen!!!


function checksumCheck(packet) {
	var chksum = packet.header[0].charCodeAt(0) + packet.header[1].charCodeAt(0) + packet.header[2].charCodeAt(0) + (packet.pt.pt_hasData | packet.pt.pt_is_batch) + parseInt(packet.address, 16);
	var chksum1 = (chksum >>> 8) >>>0;
	var chksum0 = (chksum & 0xFF);

	if(chksum0 === packet.chksum0 && chksum1 === packet.chksum1) {
		packet.chksumChecked = true;
	} else {
		packet.chksumChecked = false;
		console.error("checksum of packet didn't match computed checksum!!!");
	}
	// console.log("s: " + packet.header[0].charCodeAt(0));
	// console.log("n: " + packet.header[1].charCodeAt(0));
	// console.log("p: " + packet.header[2].charCodeAt(0));
	// // console.log("p???: "+packet.header[2]);
	// console.log("pt_hasdata: " + packet.pt.pt_hasData);
	// console.log("pt_is_batch: " + packet.pt.pt_is_batch);
	// console.log("hasdata + isbatch: " + (packet.pt.pt_hasData | packet.pt.pt_is_batch));
	// console.log("address: " + parseInt(packet.address, 16));
	// console.log("chksum: " + chksum);
	// console.log("chksum1: " + chksum1 + " " + packet.chksum1);
	// console.log("chksum0: " + chksum0 + " " + packet.chksum0);


}

// var chunk = "";
var chunk = new Array(0);
var packetDataBuff = new Array(0);
var packetChksumBuff = new Array(0);
var packet = 0;
sp.on("open", function() {

	sp.on("data", function(data) {
		// console.log("-------");
		// console.log(data);
		for(var i = 0; i < data.length; i++) {
			chunk.push(data[i]);
			// packetTest.push(data[i]);
			// console.log(chunk[i].toString(16));
			//bytes sammeln bis "snp"+PT+adress erst dann soll was gemacht werden weil im PT die Menge der Daten steht
			if(chunk.length >= 5) {
				// console.log(new Buffer(chunk));
				// console.log();
				if(String.fromCharCode(chunk[0]) == 's' && String.fromCharCode(chunk[1]) == 'n' && String.fromCharCode(chunk[2]) == 'p') { //sammelt alle bytes und schaut ob ein neues Packet ist
					var packetType = readPT(chunk[3].toString(2));
					// console.log(packetType);
					// console.log(typeof packetType.address);
					// console.log("ptlen0: " + (4 + packetType.pt_bl + 3));
					// packetType.pt_bl
					if(chunk.length >= 6) {
						if(packetDataBuff.length < packetType.pt_bl) {
							// console.log("blaaaaaaaaa");
							packetDataBuff.push(data[i]);


						} else {
							packetChksumBuff.push(data[i]);
						}
					}

					var packetlength = (5 + packetType.pt_bl + 2);
					// console.log("stringlength: " + chunk.length);
					//bytes sammeln bis "snp"+PT+adress+chksum0+chksum1
					if(chunk.length == packetlength) {
						packet = {
							header: "snp",
							pt: packetType,
							address: "0x" + chunk[4].toString(16),
							data: packetDataBuff,
							chksum1: packetChksumBuff[0],
							chksum0: packetChksumBuff[1],
							chksumChecked: 0

						}

						checksumCheck(packet);

						//ein Packet vom UM6 mit Zieladresse 0xFD heißt dass die gesendete Checksumme nicht gepasst hat
						if(packet.address == 0xFD) {
							console.error("wrong checksum was sent!!! try again...");
						} else{
							console.log("packet sent looks like ok...");
						}

						// console.log(packet);
						// var packetlengthcount = 0;
						// for(var j = 0; j < chunk.length; j++) {
						// 	packetlengthcount++;
						// }
						// console.log("packet is full with " + packetlength + " bytes");
						// // console.log("packetlengthcount: " + packetlengthcount);
						// console.log("datalength: "+packetDataBuff);
						// console.log("chksumlength: "+packetChksumBuff);
						// console.log("packet: "+chunk);
						// console.log("bytelength: " + Buffer.byteLength(chunk));
						process.exit(code = 0);

					}

					// console.log(PT[0]);
					// console.log(PT[1]);
					// console.log(PT[2]);
					// console.log(PT[3]);
					// console.log(PT[4]);
					// console.log(PT[5]);
					// console.log(PT[6]);
					// console.log(PT[7]);
				}
			}
		}

		// 110
		// 112
		// 0
		// 253
		// 2
		// 78
		// if(packet.length == 7){
		// 	console.log("packetstring_length:"+Buffer.byteLength(packet));
		// 	console.log("array:"+packetTest);
		// }
		// console.log("------");
	});
	sp.on("error", function(e) {
		console.error(e);
	});


	sendUM6(0xAA); // 0xAA 170 um6_get_fw_version

});





/**
* Sends Packets to the UM6, just give it the Address and it does the rest (generate chksum)
*
* @method sendUM6
* @param {HEX} address Address of the Register of the Sensor
* @TODO PT sollte auch über Argumente konfiguriert werden können.....
*/
function sendUM6(address) {
	// daten müssen in einem buffer verpackt werden und dann geschickt sonst funktionierts nicht
	// (hat 3 tage gedauert bis ich dass herausgefunden habe!!!!!!)


// ############ Packet Header ###############
	var headerPacket = new Buffer(5);
	headerPacket.writeUInt8(0x73,0); //UInt8 für unsigned char    // 0x73 ='s'
	headerPacket.writeUInt8(0x6E,1); // 0x6E = 'n'
	headerPacket.writeUInt8(0x70,2); //0x70 = 'p'
	headerPacket.writeUInt8(0,3);
	headerPacket.writeUInt8(address,4);
// ############ Packet Data #################

// hier noch einen Data buffer machen der aus anzahl der bytes im PT-byte besteht....
// brauche aber wahrscheinlich niemals daten an den Sensor schicken


// ############ Packet Checksum #####################
	var chksumPacket = new Buffer(2); // Checksum besteht aus 2 Bytes

	var chksum = 0;
	for (var i = 0; i < headerPacket.length; i++){
		chksum += headerPacket[i]; // zusammenzählen aller Bytes aus dem Packet
	}
	var chksum1 = (chksum >>> 8) >>>0; // Byte hat 8 Bit, also die ersten 8 stellen wegschmeissen
	var chksum0 = (chksum & 0xFF); // hier werden dann die ersten 8 bit hineingespeichert

	chksumPacket.writeUInt8(chksum1,0);
	chksumPacket.writeUInt8(chksum0,1);

	sp.write(headerPacket);
	sp.write(chksumPacket);

}