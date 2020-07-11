//Given little-endian 16-bit mono 44100 PCM byte array 
// will return byte array of corresponding WAV file.

"use strict";

const intToBytes = (input) => {
    var byteArray = [0, 0, 0, 0];

    for ( var index = 0; index < byteArray.length; index ++ ) {
        var byte = input & 0xff;
        byteArray [ index ] = byte;
        input = (input - byte) / 256 ;
    }

    return byteArray;
}

const saveStringAsBytes = (stringValue, target, offset) => {
    for (let i = 0; i < stringValue.length; i++) {
        target[offset+i] = stringValue.charCodeAt(i);
    }
}

const saveIntAsBytes = (intValue, target, offset) => {
    let bytes = intToBytes(intValue);

    for (let i = 0; i < bytes.length; i++) {
        target[offset+i] = bytes[i];
    }
}

//only mono 44100 now!
const getWavUint8Array = (byteArrayInput) => {
    const WAV_HEADER_BYTE_SIZE = 44;
    const WAV_DATA_BYTE_SIZE = byteArrayInput.length;
    const AUDIO_SAMPLE_RATE  = 44100;
    const NUMBER_OF_AUDIO_CHANNELS = 1;
    const AUDIO_BITS_PER_SAMPLE  = 16;

    let header = new Uint8Array(WAV_HEADER_BYTE_SIZE);

    //chunkId marker
    const MARKER = "RIFF"
    saveStringAsBytes(MARKER, header, 0);

    //Byte size of area that goes after chunkId and chunkSize value (4 bytes).
    //It is calculated as full file size MINUS 8 bytes.
    const OVERALL_SIZE = WAV_HEADER_BYTE_SIZE + WAV_DATA_BYTE_SIZE;
    saveIntAsBytes(OVERALL_SIZE - 8, header, 24);

    //formate identifier
    const HEADER = "WAVE";
    saveStringAsBytes(HEADER, header, 8);

    //marker for subChunk1 (format subchunk)
    const FORMAT_CHUNK_MARKER = "fmt ";
    saveStringAsBytes(FORMAT_CHUNK_MARKER, header, 12);

    //subchunk1 size excluding previous two 4-byte values.
    header[16] = 16;

    //type of format 1 = PCM, others values for compressed sound
    header[20] = 1;

    //number of channels 1 = MONO
    header[22] = 1;

    //sample rate. Means how many samples represent 1 second of sound.
    saveIntAsBytes(AUDIO_SAMPLE_RATE, header, 24);

    //byte rate per second
    const BYTE_RATE = AUDIO_SAMPLE_RATE*NUMBER_OF_AUDIO_CHANNELS*AUDIO_BITS_PER_SAMPLE/8;
    saveIntAsBytes(BYTE_RATE, header, 28);

    //block align. Number of bytes per sample if we sum them for ALL channels.
    const BLOCK_ALIGN = NUMBER_OF_AUDIO_CHANNELS*AUDIO_BITS_PER_SAMPLE/8;
    header[32] = BLOCK_ALIGN;

    //bits per sample
    header[34] = AUDIO_BITS_PER_SAMPLE;

    //marker for subchunk2 (data subchunk)
    const DATA_MARKER = "data";
    saveStringAsBytes(DATA_MARKER, header, 36);

    //data-size
    saveIntAsBytes(WAV_DATA_BYTE_SIZE, header, 40);

    //header + data = wav file
    let result = new Uint8Array(WAV_HEADER_BYTE_SIZE+WAV_DATA_BYTE_SIZE);
    result.set(header);
    result.set(byteArrayInput, WAV_HEADER_BYTE_SIZE);

    return result;
}

export default getWavUint8Array;