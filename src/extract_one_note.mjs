import parseSF2 from "../public/modules/parseSF2.mjs";
import * as fs from 'fs';
import getWavUint8Array from '../public/modules/pcm_to_wav.mjs';

let sf2Data = fs.readFileSync("public/soundfonts/YDP-GrandPiano-20160804.sf2", null)

var parsedData = parseSF2(sf2Data);
let soundLinearCodedBytes = parsedData.samples[11].data;
console.log(parsedData.samples[11])
let wav = getWavUint8Array(soundLinearCodedBytes);

fs.writeFileSync('note.wav', wav);