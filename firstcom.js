/**
 * Sends Packets to the UM6 and Receives them
 *
 *
 *
 * @TODO den empfangsteil in Buffer umbauen, damit ja keine Daten verloren gehen!!!!
 */
var util = require("util");
var debug = false;


var serialport = require("serialport");
var SerialPort = serialport.SerialPort;
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

// Hilfsfunktion um einen Stacktrace zu erhalten

function dumpError(err) {
	if (typeof err === 'object') {
		if (err.message) {
			console.log('\nMessage: ' + err.message)
		}
		if (err.stack) {
			console.log('\nStacktrace:')
			console.log('====================')
			console.log(err.stack);
		}
	} else {
		console.log('dumpError :: argument is not an object');
	}
}

// liest das bit in einem Byte auf einer bestimmten Position aus
// wenn das bit 0 ist, dann return 0, wenn das bit eine andere Zahl ist, dann return 1

function readBits(byte, bitPos) {
	var x = (byte & (1 << bitPos));
	return x === 0 ? 0 : 1;
}

// liest alle Options aus dem empfangenen PT aus  

function readPT(ptByte) {
	var pt = {
		pt_hasData: readBits(ptByte, 7),
		pt_is_batch: readBits(ptByte, 6),
		pt_bl: parseInt("" + readBits(ptByte, 5) + readBits(ptByte, 4) + readBits(ptByte, 3) + readBits(ptByte, 2), 2),
		pt_res: 0,
		pt_cf: readBits(ptByte, 0),
		pt_dataLength: 0
	};

	if (pt.pt_hasData === 1) {
		if (pt.pt_is_batch === 0) {
			pt.pt_dataLength = 4; //non-batch operation (Is Batch = 0), the length of the data section is equal to 4 bytes (one register)
		} else {
			//  the length of the packet data section is equal to 4*(Batch Length). Note that the batch length refers to the number of registers in the batch, NOT the number of bytes. Registers are 4 bytes long.
			pt.pt_dataLength = (parseInt("" + readBits(ptByte, 5) + readBits(ptByte, 4) + readBits(ptByte, 3) + readBits(ptByte, 2), 2)) * 4;
		}
	}
	// console.log("pt: "+util.inspect(pt));
	return pt;
}

/**
 * Reads PT_Byte aus fertigem Packet. Zum Checken der Checksum.
 *
 * @method makePT
 * @param {Packet} pack fertig empfangenes Packet
 * @return {int} ptByte als Integer
 */

function makePT(pack) {
	var ptByte = '';
	ptByte = ptByte.concat(pack.pt.pt_hasData.toString());
	ptByte = ptByte.concat(pack.pt.pt_is_batch.toString(2));
	var bl = ((pack.pt.pt_bl)).toString(2);
	// console.log("bl: "+bl);
	for (var i = 0; i < (4 - pack.pt.pt_bl.toString(2).length); i++) {
		bl = "0".concat(bl); //erstellt mir einen String mit immer 4-Stellen für die 4 BL-Bits
	}
	// console.log("bl1: "+bl);
	ptByte = ptByte.concat(bl);
	ptByte = ptByte.concat(pack.pt.pt_res.toString());
	ptByte = ptByte.concat(pack.pt.pt_cf.toString());
	// console.log("ptbyte: "+ptByte);

	return parseInt(ptByte, 2);
}

//überprüft ob die gesendeten Daten auch mit der gesendeten Checksumme übereinstimmen!!!

function checksumCheck(pack) {
	// ############ Packet Header ###############
	var headerPacket = new Buffer(5);
	headerPacket.writeUInt8(0x73, 0); //UInt8 für unsigned char    // 0x73 ='s'
	headerPacket.writeUInt8(0x6E, 1); // 0x6E = 'n'
	headerPacket.writeUInt8(0x70, 2); //0x70 = 'p'
	headerPacket.writeUInt8(makePT(pack), 3);
	headerPacket.writeUInt8(pack.address, 4);

	// ############ Packet Data ###############
	var dataPacket = new Buffer(pack.pt.pt_dataLength);
	for (var i = 0; i < dataPacket.length; i++) {
		dataPacket.writeUInt8(pack.data[i], i);
	}

	// ############ Packet Checksum #####################
	var chksumPacket = new Buffer(2); // Checksum besteht aus 2 Bytes
	var chksum = 0;
	for (var i = 0; i < headerPacket.length; i++) {
		chksum += headerPacket[i]; // zusammenzählen aller Bytes aus dem Packet Header
	}
	for (var i = 0; i < dataPacket.length; i++) {
		chksum += dataPacket[i]; // zusammenzählen aller Bytes aus dem Packet Data
	}
	var chksum1 = (chksum >>> 8) >>> 0; // Byte hat 8 Bit, also die ersten 8 stellen wegschmeissen
	var chksum0 = (chksum & 0xFF); // hier werden dann die ersten 8 bit hineingespeichert
	chksumPacket.writeUInt8(chksum1, 0);
	chksumPacket.writeUInt8(chksum0, 1);

	if (chksumPacket[1] === pack.chksum0 && chksumPacket[0] === pack.chksum1) {
		pack.chksumChecked = true;
		debug === true ? console.log("checksum of received packet checks out...") : 0;
	} else {
		pack.chksumChecked = false;
		debug === true ? console.log("checksum of packet didn't match computed checksum!!!") : 0;
	}
}

function processDataReceive(data, chunk, packetDataBuff, packetDataBuffCount, packetChksumBuff, pack) {
	for (var i = 0; i < data.length; i++) {
		try {
			// console.log("1: ");
			chunk.push(data[i]);
			//bytes sammeln bis "snp"+PT+adress erst dann soll was gemacht werden weil im PT die Menge der Daten steht
			if (chunk.length >= 5) {
				// console.log("2: ");
				if (String.fromCharCode(chunk[0]) == 's' && String.fromCharCode(chunk[1]) == 'n' && String.fromCharCode(chunk[2]) == 'p') { //sammelt alle bytes und schaut ob ein neues Packet ist
					var packetType = readPT(chunk[3]);

					if (chunk.length >= 6) {

						if (packetDataBuff.length < packetType.pt_dataLength) {
							// console.log("pt_bl: " + packetType.pt_bl);
							packetDataBuff = new Buffer(packetType.pt_dataLength);
							// console.log("info: " + packetDataBuff.length);
							packetDataBuffCount = 0;
							packetDataBuff.writeUInt8(data[i], packetDataBuffCount);
							packetDataBuffCount++;
						} else if (packetDataBuffCount < packetType.pt_dataLength) {
							packetDataBuff.writeUInt8(data[i], packetDataBuffCount);
							packetDataBuffCount++;
						} else {
							packetChksumBuff.push(data[i]);
						}
					}
					var packetlength = (5 + packetType.pt_dataLength + 2);
					// console.log("packetlength: "+packetType.dataLength);
					//bytes sammeln bis "snp"+PT+adress+chksum0+chksum1
					if (chunk.length == packetlength) {
						pack = {
							header: "snp",
							pt: packetType,
							address: chunk[4],
							data: packetDataBuff,
							chksum1: packetChksumBuff[0],
							chksum0: packetChksumBuff[1],
							chksumChecked: 0
						}
						checksumCheck(pack);
						//ein Packet vom UM6 mit Zieladresse 0xFD heißt dass die gesendete Checksumme nicht gepasst hat
						if (pack.address == 0xFD) {
							debug === true ? console.log("wrong checksum was sent!!! try again...") : 0;
							return null;
						} else {
							debug === true ? console.log("packet sent looks like ok...") : 0;
							return pack;
						}
					}
				}
			}

		} catch (err) {
			dumpError(err);
		}
	}
	return null;
}
/**
 * Sends Packets to the UM6, just give it the Address and it does the rest (generate chksum)
 *
 * @method sendUM6
 * @param {HEX} address Address of the Register of the Sensor
 * @TODO PT sollte auch über Argumente konfiguriert werden können.....
 */

function sendUM6(address, batchlength) {
	// daten müssen in einem buffer verpackt werden und dann geschickt sonst funktionierts nicht
	// (hat 3 tage gedauert bis ich dass herausgefunden habe!!!!!!)
	// ############ Packet Header ###############
	var headerPacket = new Buffer(5);
	headerPacket.writeUInt8(0x73, 0); //UInt8 für unsigned char    // 0x73 ='s'
	headerPacket.writeUInt8(0x6E, 1); // 0x6E = 'n'
	headerPacket.writeUInt8(0x70, 2); //0x70 = 'p'
	if (batchlength === undefined) {
		headerPacket.writeUInt8(0, 3);
	} else {
		var bl = batchlength.toString(2);
		for (var i = 0; i < (4 - batchlength.toString(2).length); i++) {
			bl = "0".concat(bl); //erstellt mir einen String mit immer 4-Stellen für die 4 BL-Bits
		}
		var pt = "01" + bl + "00";
		headerPacket.writeUInt8(parseInt(pt, 2), 3);
		// console.log("pt: " + parseInt(pt,2));
	}
	headerPacket.writeUInt8(address, 4);
	// ############ Packet Data #################
	// hier noch einen Data buffer machen der aus anzahl der bytes im PT-byte besteht....
	// brauche aber wahrscheinlich niemals daten an den Sensor schicken
	// ############ Packet Checksum #####################
	var chksumPacket = new Buffer(2); // Checksum besteht aus 2 Bytes
	var chksum = 0;
	for (var i = 0; i < headerPacket.length; i++) {
		chksum += headerPacket[i]; // zusammenzählen aller Bytes aus dem Packet
	}
	var chksum1 = (chksum >>> 8) >>> 0; // Byte hat 8 Bit, also die ersten 8 stellen wegschmeissen
	var chksum0 = (chksum & 0xFF); // hier werden dann die ersten 8 bit hineingespeichert, 0xFF brauche ich als abschluss
	chksumPacket.writeUInt8(chksum1, 0);
	chksumPacket.writeUInt8(chksum0, 1);

	// console.log("chks1: " + chksum1.toString(16));
	// console.log("chks0: " + chksum0.toString(16));
	sp.write(headerPacket);
	sp.write(chksumPacket);

}

function decodeStatus(pack) {
	// var dataBuff = pack.data;
	var dataBuff = new Buffer(new Array(243, 187, 30, 154));
	var statusBinStr = "";
	var bitcounter = 0;


	// console.log("status: "+statusBinStr);


	var status = {
		st: 0, //0 self-test operation was completed
		mag_del: 0, //13 processor did not receive data from the magnetic sensor for longer than expected
		acc_del: 0, //14 processor did not receive data from the accelerometer for longer than expected
		gyr_del: 0, //15 processor did not receive data from the rate gyros for longer than expected
		ekf_div: 0, //16 EKF state estimates became divergent and the EKF was forced to restart
		bus_mag: 0, //17 bus error while communicating with the magnetic sensor
		bus_acc: 0, //18 bus error while communicating with the accelerometers
		bus_gyr: 0, //19  bus error while communicating with the rate gyros
		st_mz: 0, //20 self-test operation failed on the magnetometer z-axis
		st_my: 0, //21 self-test operation failed on the magnetometer y-axis
		st_mx: 0, //22 self-test operation failed on the magnetometer x-axis
		st_az: 0, //23 self-test operation failed on the accelerometer z-axis
		st_ay: 0, //24 self-test operation failed on the accelerometer y-axis
		st_ax: 0, //25 self-test operation failed on the accelerometer x-axis
		st_gz: 0, //26  self-test operation failed on the rate gyro z-axis
		st_gy: 0, //27 self-test operation failed on the rate gyro y-axis
		st_gx: 0, //28 self-test operation failed on the rate gyro x-axis
		gyr_ini: 0, //29  rate gyro startup initialization failed. Usually indicates that the rate gyro is damaged
		acc_ini: 0, //30  accelerometer startup initialization failed. Usually indicates that the accelerometer is damaged
		mag_ini: 0, //31 magnetometer startup initialization failed. Usually indicates that the magnetometer is damaged
	};
	var statusPropertiesList = Object.keys(status);
	var statusPropertiesListCounter = 0;
	for (var i = 0; i < dataBuff.length; i++) {
		for (var ii = 0; ii < 8; ii++) {
			if (!(bitcounter <= 12 && bitcounter >= 1)) {
				status[statusPropertiesList[statusPropertiesListCounter]] = readBits(dataBuff[i], bitcounter);
				statusPropertiesListCounter++;
			};
			bitcounter++;
		};
	};
	return status;
}

// 0x62 UM6_EULER_PHI_THETA
// 0x63 UM6_EULER_PSI

function processPacket(pack) {
	// console.log("address: "+pack.address);
	switch (pack.address) {
		case 0x76:
			console.log("temperature: " + pack.data.readFloatBE(0));
			break;
		case 0xAA:
			console.log("Firmware: " + pack.data);
			break;
		case 0x55:
			console.log("status: " + util.inspect(decodeStatus(pack)));
			break;
		case 0x62:
			if (pack.pt.pt_dataLength === 8) {
				// console.log("datatype: "+typeof(pack.data));
				var roll_phi = (pack.data.readInt16BE(0) * 0.0109863) | 0; // mit |0 kann ich math.round machen, aber immer nach unten gerundet!!!!
				var pitch_theta = (pack.data.readInt16BE(2) * 0.0109863) | 0;
				var yaw_psi = (pack.data.readInt16BE(4) * 0.0109863) | 0;
				console.log("roll_phi: " + roll_phi + " pitch_theta: " + pitch_theta + " yaw_psi: " + yaw_psi);
			} else {
				console.log("UM6_EULER_PHI_THETA: " + util.inspect(pack.data));
			}
			break;
		case 0x63:
			console.log("UM6_EULER_PSI: " + util.inspect(pack.data));
			break;
		case 0x64:
			if (pack.pt.pt_dataLength === 8) {
				// console.log("datatype: "+typeof(pack.data));
				var quat_a = (pack.data.readInt16BE(0) * 0.0000335693); // mit |0 kann ich math.round machen, aber immer nach unten gerundet!!!!
				var quat_b = (pack.data.readInt16BE(2) * 0.0000335693);
				var quat_c = (pack.data.readInt16BE(4) * 0.0000335693);
				var quat_d = (pack.data.readInt16BE(6) * 0.0000335693);
				// console.log("quat_a: " + quat_a + " quat_b: " + quat_b + " quat_c: " + quat_c+ " quat_d: " + quat_d);
				var quaternion = {
					a: quat_a,
					b: quat_b,
					c: quat_c,
					d: quat_d
				};
				return quaternion;
			} 
			break;


	}

	// console.log("packetdata: " + pack.data.readFloatBE(0));
}


sp.on("open", function() {
	var chunk = new Array(0);
	var packetDataBuff = new Buffer(0);
	var packetDataBuffCount = 0;
	var packetChksumBuff = new Array(0);
	var pack = 0;

	sp.on("data", function(data) {
		pack = processDataReceive(data, chunk, packetDataBuff, packetDataBuffCount, packetChksumBuff, pack);
		// console.log("pack: " + util.inspect(data));
		if (pack !== null) {
			processPacket(pack);
			chunk = new Array(0);
			packetDataBuff = new Buffer(0);
			packetDataBuffCount = 0;
			packetChksumBuff = new Array(0);
			pack = 0;
		}
	});
	sp.on("error", function(e) {
		dumpError(e);
	});
	// 0xAA 170 um6_get_fw_version
	// 0x76 UM6_TEMPERATURE
	// 0x62 UM6_EULER_PHI_THETA
	// 0x63 UM6_EULER_PSI
	// sendUM6(0x62, 2); // 0xAA 170 um6_get_fw_version
});