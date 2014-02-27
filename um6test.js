var serialport = require("serialport");
var SerialPort = serialport.SerialPort;
// localize object constructor

var sp = new SerialPort("COM17", {
	parser : serialport.parsers.raw,
	baudrate : 115200

});

sp.on("data", function(data) {
	getPackets(data);
});

// A function which can be used with the 'serialport' npm package
// and a XBee radio in API mode.
// It builds a JS array of integers as data is received, and when the
// array represents a complete XBee packet, it emits it as a 'data' event,
// passing a JS object (as translated by packetToJS) instead of a load of numbers.

// incoming data buffer saved in closure as a JS array of integers called 'packet'
var packet = [];
var packpos = 999;
// this variable is used to remember at which position we are up to within the overall packet
var packlen = 0;
// used to remember the length of the current packet. XBee API packets have two length bytes immediately after the start byte

START_BYTE = 0x7e;              // start of every XBee packet

function getPackets(buffer) {
	// Collecting data. 'buffer' needs to be run through - it contains bytes received from the serial port
	// which may or may not represent an entire XBee packet.
	console.log(buffer.length);

	for (var i = 0; i < buffer.length; i++) {
		b = buffer[i];
		// store the working byte
		packpos += 1;

		if (b == START_BYTE) {
			// Detected start of packet.
			// exports.START_BYTE = 126, the start of a zigbee packet i.e. 0x7e
			packpos = 0;
			packlen = 0;
			// length of packet is unknown, as yet.
			packet = [];
			// store the bytes as they come in. Don't keep start byte or length bytes
		}
		if (packpos == 1) {
			// most significant bit of the length
			packlen += b << 8;
		}
		if (packpos == 2) {
			// least significant bit of the length
			packlen += b;
		}

		// for all other bytes, collect them onto the end of our growing 'packet' array
		if ((packlen > 0) && (packpos > 2) && (packet.length < packlen)) {
			packet.push(b);
		}

		// emit the packet when it's fully built. packlen + 3 = position of final byte
		if ((packlen > 0) && (packet.length == packlen) && (packpos == packlen + 3)) {
			// translate the packet into a JS object before emitting it
			// emitter.emit("data", packetToJS(packet));
			console.log(packet);

		}

		// there will still be a checksum byte. Currently this is ignored
		if ((packlen > 0) && (packet.length == packlen) && (packpos > packlen + 3)) {
			// ignore checksum for now
		}
	}
};
function packetToJS(packet) {
	// given an array of byte values, return a JS object representing the packet
	// the array of bytes excludes the start bit and the length bits (these are not collected by the serial parser funciton)

	// So, the first byte in the packet is the frame type identifier.
	if (packet[0] == exports.FT_AT_RESPONSE) {
		return {
			type : 'AT Response',
			frameId : packet[1],
			command : String.fromCharCode(packet[2]) + String.fromCharCode(packet[3]), // translate bytes back to ASCII
			commandStatus : (packet[4] == 0) ? 'OK' : packet[4],
			commandData : packet.slice(4),
			bytes : packet
		}
	} else if (packet[0] == exports.FT_REMOTE_AT_RESPONSE) {
		return {
			type : 'Remote AT Response',
			frameId : packet[1],
			remote64 : {
				dec : packet.slice(2, 10),
				hex : byteArrayToHexString(packet.slice(2, 10))
			},
			remote16 : {
				dec : packet.slice(10, 12),
				hex : byteArrayToHexString(packet.slice(10, 12))
			},
			command : String.fromCharCode(packet[12]) + String.fromCharCode(packet[13]),
			commandStatus : (packet[14] == 0) ? 'OK' : packet[14],
			commandData : packet.slice(15),
			bytes : packet
		}
	} else if (packet[0] == exports.FT_RECEIVE_RF_DATA) {
		p = {
			type : 'RF Data',
			remote64 : {
				dec : packet.slice(1, 9),
				hex : byteArrayToHexString(packet.slice(1, 9))
			},
			remote16 : {
				dec : packet.slice(9, 11),
				hex : byteArrayToHexString(packet.slice(9, 11))
			},
			receiveOptions : packet[11],
			raw_data : packet.slice(12),
			data : "",
			bytes : packet
		}
		// build ascii from raw_data
		for (i in p.raw_data) {
			p.data += String.fromCharCode(p.raw_data[i]);
		}
		return p
	} else if (packet[0] == exports.FT_DATA_SAMPLE_RX) {
		s = {
			type : 'Data Sample',
			remote64 : {
				dec : packet.slice(1, 9),
				hex : byteArrayToHexString(packet.slice(1, 9))
			},
			remote16 : {
				dec : packet.slice(9, 11),
				hex : byteArrayToHexString(packet.slice(9, 11))
			},
			receiveOptions : packet[11],
			numSamples : packet[12], // apparently always set to 1
			digitalChannelMask : packet.slice(13, 15),
			analogChannelMask : packet[15],
			bytes : packet
		}
		// Bit more work to do on an I/O data sample.
		// First check s.digitalChannelMask - are there any digital samples?
		if (s.digitalChannelMask[0] + s.digitalChannelMask[1] > 0) {
			// digital channel mask indicates that digital samples are present, so they
			// are in the bytes 16 and 17.
			s.digitalSamples = packet.slice(16, 18);
			// Now check whether any analog samples are present
			if (s.analogChannelMask > 0) {
				s.analogSamples = packet.slice(18);
			}
		} else {
			// no digital samples. There might still be analog samples...
			if (s.analogChannelMask > 0) {
				s.analogSamples = packet.slice(16);
			}
		}

		// translate digital samples into JS for easier handling
		s['samples'] = {}

		if (s.digitalChannelMask[0] + s.digitalChannelMask[1] > 0) {// if digital samples present,
			// run through the first bitmask for digital pins, i.e. digiPinsByte1
			for (x in digiPinsByte1) {
				// On first iteration, for example, x = 'D10', digiPinsByte1[x] = 4.
				// OK. So, is there a sample for this pin? Check the digital channel mask.
				if (s.digitalChannelMask[0] & digiPinsByte1[x]) {
					// There is a sample for this pin. So, AND the sample byte and the bitmask,
					// and turn the result into a boolean.
					// On the first iteration, for example, this sets s['D10'] = 1
					// if the bitwise AND of the first byte of the digital sample with 4 is > 0
					s['samples'][x] = ((s.digitalSamples[0] & digiPinsByte1[x]) > 0) ? 1 : 0;
				}
			}
			// do the same thing for the second load of digital inputs
			for (x in digiPinsByte2) {
				if (s.digitalChannelMask[1] & digiPinsByte2[x]) {
					s['samples'][x] = ((s.digitalSamples[1] & digiPinsByte2[x]) > 0) ? 1 : 0;
				}
			}
		}

		// Also translate analog samples into JS
		// The analog channel mask indicates which pins are enabled as analog channels.
		if (s.analogChannelMask > 0) {
			var sampleIndex = 0;
			for (x in analogPins) {
				// on first iteration, for example, x = 'A0', analogPins[x] = 1
				if (s.analogChannelMask & analogPins[x]) {
					s['samples'][x] = 256 * s.analogSamples[sampleIndex * 2] + s.analogSamples[1 + sampleIndex * 2];
					sampleIndex += 1;
				}
			}
		}
		return s;
	} else {
		// The first byte of the packet indicates it's an as-yet unknown frame type.
		// In this case, just return the bytes.
		return packet;
	}
}

