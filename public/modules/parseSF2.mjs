/*
  Soundfont2 has RIFF based format. More details in official specification.
  I.e. http://freepats.zenvoid.org/sf2/sfspec24.pdf link.

  This implementation does not cover ALL available format nuances.

  Main goal: parse soundfont2 structure and allow samples extraction.
 */

"use strict";

/*
   MAIN function for this module.

   It takes byteArray with soundFont2 data as an input and returns 
   structure with presets, instruments and samples.

   Samples contain information about pitch and data in little-endian byte format.

   Currently module was tested with mono-sample-only soundFont2 file. It worked.
 */
const parseSF2 = (input) => {
  const chunkList = getChunks(input, 0, input.length);

  if (chunkList.length !== 1) {
    throw new Error('wrong chunk length');
  }

  const chunk = chunkList[0];
  if (chunk === null) {
    throw new Error('chunk not found');
  }

  return parseTopLevelRiffChunk(input, chunk);
};


//input must be little endian. Did not check for overflow!
const getUint = (input, offset) => {
  // X << N === X * (2**N)
  return input[offset] + (input[offset+1] << 8) +
          (input[offset+2] << 16) + (input[offset+3] <<24);
}

//with \u0000 removal!
const stringFromSubArray = (data, start, length) => {
  var str = "";

  for(var i = 0; i < length; i++)
    str += String.fromCharCode(data[start+i]);

  return str.replace(new RegExp("\u0000", 'g'), "");
}

const getChunks = function (/** @type {ByteArray} */ input, startOffset, length) {
  /** @type {number} */
  const END_INDEX = startOffset + length;

  const chunkList = [];

  let readOffset = startOffset;
  let size = 0;

  while (readOffset < END_INDEX) {
    let type = stringFromSubArray(input, readOffset, 4);
    let size = getUint(input, readOffset+4);
    readOffset += 8;
      
    chunkList.push(
      {
        type,
        size,
        offset: readOffset
      }
    );

    readOffset += size;

    // a pad byte if required to word align
    // aka size divided by 2 must have remainder 0
    if ( (size % 2) === 1
      ) {
      readOffset++;
    }
  }

  return chunkList;
};


const chunkTypeValidationCheck = (expected, actual) => {
  if (expected !== actual) {
    let message = "invalid chunk type: '" + actual + "', '" + expected + "' was expected!";
    throw new Error(message);
  }
}

const parseTopLevelRiffChunk = (data, chunk) => {
  /** @type {ByteArray} */
  //data;
  /** @type {number} */
  const ip = chunk.offset;

  chunkTypeValidationCheck('RIFF', chunk.type);

  // check signature
  const signature = stringFromSubArray(data, ip, 4);
  if (signature !== 'sfbk') {
    throw new Error("Invalid RIFF form header: '" + signature + "', 'sfbk' was expected!");
  }

  // read structure
  const chunkList = getChunks(data, ip+4, chunk.size - 4);

  if (chunkList.length !== 3) {
    throw new Error('RIFF structure MUST contain 3 chunks (INFO, stda, pdta), but this one has ' + chunkList.length + "chunk(s)!");
  }

  // INFO-list chunk containing a number of required and optional
  // sub-chunks describing the file, its history, and its intended use
  parseInfoList(data, chunkList[0]);

  // an sdta-list chunk comprising a single sub-chunk containing
  // any referenced digital audio samples
  const singleSamplingSubchunk = parseSdtaList(data, chunkList[1]);

  //a pdta-list chunk containing nine sub-chunks which define
  // the articulation of the digital audio data

  return parsePdtaList(data, chunkList[2], singleSamplingSubchunk);
};

const parseInfoList = function (/** @type {ByteArray} */ data, chunk) {
  chunkTypeValidationCheck("LIST", chunk.type);

  // check signature
  const signature = stringFromSubArray(data, chunk.offset, 4);;
  if (signature !== 'INFO') {
    throw new Error("Invalid INFO chunk signature: '" + signature + "', 'INFO' was expected!");
  }

  // read structure
  const chunkList = getChunks(data, chunk.offset+4, chunk.size - 4);

  for (let i = 0; i < chunkList.length; i++) {
    let subChunk = chunkList[i];
    let comment = "";
    let offset = subChunk.offset;
    if (subChunk.type === "ifil") {
      comment = "sfVersionTag major: " + getWord(data, offset) + ", minor: " + getWord(data, offset+2);
    }
    else {
      comment = "type: " + subChunk.type + ", size: " + subChunk.size + ", content: " + stringFromSubArray(data, subChunk.offset, subChunk.size);
    }
  }
};

/*
  The smpl sub-chunk, if present, contains one or more “samples”
  of digital audio information in the form of linearly coded sixteen bit,
  signed, little endian (least significant byte first) words.
  Each sample is followed by a minimum of forty-six zero valued sample data points.
  These zero valued data points are necessary to guarantee that any reasonable
  upward pitch shift using any reasonable interpolator can loop on
  zero data at the end of the sound.
 */
const parseSdtaList = (/** @type {ByteArray} */ data, chunk) => {
  chunkTypeValidationCheck("LIST", chunk.type);

  // check signature
  const signature = stringFromSubArray(data, chunk.offset, 4);
  if (signature !== 'sdta') {
    throw new Error("Invalid sdta chunk signature: '" + signature + "', 'sdta' was expected!");
  }

  // read structure
  const chunkList = getChunks(data, chunk.offset+4, chunk.size - 4);

  if (chunkList.length !== 1) {
    throw new Error('stda chunk (without sm24 subchunk) MUST contain 1 subChunk, but it has ' + chunkList.length + ' subchunks!');
  }

  return chunkList[0];
};

const parsePdtaList = (/** @type {ByteArray} */ data, chunk, samplingData) => {
  // check parse target
  chunkTypeValidationCheck("LIST", chunk.type);

  // check signature
  const signature = stringFromSubArray(data, chunk.offset, 4);
  if (signature !== 'pdta') {
    throw new Error("Invalid pdta chunk signature: '" + signature + "', 'pdta' was expected!");
  }

  // read structure
  const chunkList = getChunks(data, chunk.offset+4, chunk.size - 4);


  // check number of chunks
  if (chunkList.length !== 9) {
    throw new Error('pdta chunk is HYDRA! Must have 9 subchunks. Now it is ' + chunkList.length);
  }

  const result = {};

  //preset part
  let presets = parsePhdrChunk(data, chunkList[0]);
  //populate corresponding zones!
  parseBagChunk("pbag", data, chunkList[1], presets);
  //not tested as default soundfont had no preset modulators
  parseModChunk("pmod", data, chunkList[2], presets);
  //assigning generators, which contain indices of corresponding instruments
  parseGenChunk("pgen", data, chunkList[3], presets);
  // console.log(presets);

  let instruments = parseInstChunk(data, chunkList[4]);
  parseBagChunk("ibag", data, chunkList[5], instruments);
  //not tested as default soundfont had no instrument modulators
  parseModChunk("imod", data, chunkList[6], instruments);
  //assigning generators, which contain indices of corresponding samples
  parseGenChunk("igen", data, chunkList[7], instruments);
  // console.log(instruments);

  let samples = parseShdrChunk(data, chunkList[8], samplingData);

  return {
    presets,
    instruments,
    samples
  };
};

//little endian
//WORD — A data structure of 16 bits which contains an unsigned value from 0 to 65,535
const getWord = (data, offset) => {
  return data[offset] | (data[offset+1] << 8);
}

//hmm https://stackoverflow.com/questions/10382122/what-is-operator-in-js
//DWORD — A data structure of 32 bits which contains an unsigned value from zero to 4,294,967,295.
const getDoubleWord = (data, offset) => {
  return (data[offset] | (data[offset+1] << 8) | (data[offset+2] << 16) | (data[offset+3] << 24)) >>> 0;
}

/*
   It is always a multiple of thirty-eight bytes in length,
   and contains a minimum of two records, one record for 
   each preset and one for a terminal record.

   struct sfPresetHeader {
     CHAR  achPresetName[20];
     WORD  wPreset;
     WORD  wBank;
     WORD  wPresetBagNdx;
     DWORD dwLibrary;
     DWORD dwGenre;
     DWORD dwMorphology;
   }; 
 */
const parsePhdrChunk = (/** @type {ByteArray} */ data, chunk) => {
  const presets = [];

  chunkTypeValidationCheck("phdr", chunk.type);

  let ip = chunk.offset;
  for (let i = 0; i < chunk.size / 38; i+=2) {
    let offset = i * 38 + chunk.offset;
    let preset = {
      presetName: stringFromSubArray(data, offset, 20),
      preset: getWord(data, offset+20),
      bank: getWord(data, offset+22),
      firstBagIndex: getWord(data, offset+24),
      //dwLibrary, dwGenre and dwMorphology are reserved for future implementation
      // library: getDoubleWord(data, offset+26),
      // genre: getDoubleWord(data, offset+30),
      // morphology: getDoubleWord(data, offset+34)
    };

    offset += 38;

    //The terminal sfPresetHeader record should never be accessed, and exists only to provide a terminal wPresetBagNdx with which to determine the number of zones in the last preset.
    let terminalRecord = {
      presetName: stringFromSubArray(data, offset, 20),
      preset: getWord(data, offset+20),
      bank: getWord(data, offset+22),
      firstBagIndex: getWord(data, offset+24)
    };

    //CUSTOM!!!
    preset.lastBagIndex = terminalRecord.firstBagIndex;

    presets.push(preset);
  }

  return presets;
};

/*
   The PBAG sub-chunk is a required sub-chunk listing all preset zones
   within the SoundFont compatible file.  It is always a multiple of four bytes
   in length, and contains one record for each preset zone plus
   one record for a terminal zone.

   The IBAG sub-chunk is a required sub-chunk listing all instrument zones
   within the SoundFont compatible file.  It is always a multiple of four bytes
   in length, and contains one record for each instrument zone plus
   one record for a terminal zone.

   These structures are parsed in the same way so one function will handle both.

   For presets:

   struct sfPresetBag {
     WORD  wGenNdx;
     WORD  wModNdx;
   };

   For instruments:

   struct sfInstBag {
     WORD  wInstGenNdx;
     WORD  wInstModNdx;
   }
 */
const parseBagChunk = (chunkName, /** @type {ByteArray} */ data, chunk, zoneOwners) => {
  chunkTypeValidationCheck(chunkName, chunk.type);

  let lastHeader = zoneOwners[zoneOwners.length-1];
  //4 bytes per record plus one terminal
  let expectedBagChunkSize = (lastHeader.lastBagIndex)*4 + 4;

  if (expectedBagChunkSize !== chunk.size) {
    throw new Error("Chunk "+chunkName+" has size of "+chunk.size+
      " but "+expectedBagChunkSize+" was expected!");
  }

  for (let i = 0; i < zoneOwners.length; i++) {
    let currentOwner = zoneOwners[i];
    currentOwner.zones = [];

    let from = currentOwner.firstBagIndex;
    let to = currentOwner.lastBagIndex;
    for (let j = from; j < to; j++) {
      let zone = {
        generatorIndex: getWord(data, chunk.offset + j*4),    //PGEN index
        modulatorIndex: getWord(data, chunk.offset + j*4 +2)  //PMOD  index
      };
      currentOwner.zones.push(zone);
    }
  }
};

/*
  Always a multiple of four bytes in length, and contains one or more
  generators for each preset zone (except a global zone containing only modulators)
  plus a terminal record.

  While there is differentce in a way generators are assigned to zones of presets
  and instruments. There are still many common steps so both handled by one function.
 */
const parseGenChunk = (chunkName, data, chunk, owners) => {
  chunkTypeValidationCheck(chunkName, chunk.type);

  let generators = parseGenerators(data, chunk);

  for (let i = 0; i < owners.length; i++) {
    let currentOwner = owners[i];
    for (let j = 0; j < currentOwner.zones.length; j++) {
      let currentZone = currentOwner.zones[j];
      currentZone.generators = [];

      if (chunkName === "pgen") {
        pgen_loop:
        for (let k = currentZone.generatorIndex; k < generators.length; k++) {
          let nextGenerator = generators[k];
          currentZone.generators.push(nextGenerator);

          if (nextGenerator.operation === "instrument") {
            //CUSTOM!!!
            currentZone.instrumentIndex = nextGenerator.value.signedAmount;

            break pgen_loop;
          }
        }
      }
      else if ( chunkName === "igen") {
        igen_loop:
        for (let k = currentZone.generatorIndex; k < generators.length; k++) {
          let nextGenerator = generators[k];
          currentZone.generators.push(nextGenerator);

          if (nextGenerator.operation === "releaseVolEnv" //?why is this like that?
              || nextGenerator.operation === "sampleID") {
            //CUSTOM!!!
            if  (nextGenerator.operation === "sampleID") {
              currentZone.sampleIndex = nextGenerator.value.signedAmount;
            }

            break igen_loop;
          }
        }
      }
    }
  }
};

/*
  It is always a multiple of twenty-two bytes in length,
  and contains a minimum of two records, one record for
  each instrument and one for a terminal record.

  struct sfInst {
    CHAR achInstName[20];
    WORD wInstBagNdx;
  }; 
 */
const parseInstChunk = (/** @type {ByteArray} */ data, chunk) => {
  const instruments = [];

  chunkTypeValidationCheck("inst", chunk.type);

  //terminal sfInst record should never be accessed, and exists only
  //to provide a terminal wInstBagNdx with which to determine
  //the number of zones in the last instrument
  for (let i = 0; i < chunk.size-22; i+=22) {
    let index = chunk.offset+i;
    let instrument = {
      instrumentName: stringFromSubArray(data, index, 20),
      firstBagIndex: getWord(data, index+20),
      lastBagIndex: getWord(data, index+42)
    };

    instruments.push(instrument);
  }

  return instruments;
};

// According to spec for parsing Shdr.
const getSampleType = (value) => {
  if (value === 1) {
    return "monoSample";
  }
  else if (value === 2) {
    return "rightSample";
  }
  else if (value === 4) {
    return "leftSample";
  }
  else if (value === 8) {
    return "linkedSample";
  }
  else if (value === 32769) {
    return "RomMonoSample";
  }
  else if (value === 32770) {
    return "RomRightSample";
  }
  else if (value === 32772) {
    return "RomLeftSample";
  }
  else if (value === 32776) {
    return "RomLinkedSample";
  }
}

/*
   Always a multiple of 46 bytes in length, and
   contains one record for each sample plus a terminal record. Structure:

   struct sfSample {
      CHAR            achSampleName[20];
      DWORD           dwStart;
      DWORD           dwEnd;
      DWORD           dwStartloop;
      DWORD           dwEndloop;
      DWORD           dwSampleRate;
      BYTE            byOriginalPitch;
      CHAR            chPitchCorrection;
      WORD            wSampleLink;
      SFSampleLink    sfSampleType;
   }; 
 */
const parseShdrChunk = (/** @type {ByteArray} */ data, chunk, samplingData) => {
  let readOffset = chunk.offset;
  const samples = [];
  const size = chunk.offset + chunk.size;

  chunkTypeValidationCheck("shdr", chunk.type);

  //The terminal sample record is never referenced, and is conventionally
  //entirely zero with the exception of achSampleName,
  //which should be “EOS” indicating end of samples
  while (readOffset < size-46) {
    let sampleName = stringFromSubArray(data, readOffset, 20);
    readOffset+=20;

    let start = getDoubleWord(data, readOffset);
    let end = getDoubleWord(data, readOffset+4);
    let startLoop = getDoubleWord(data, readOffset+8) - start; //to get relative offset
    let endLoop = getDoubleWord(data, readOffset+12) - start;
    let sampleRate = getDoubleWord(data, readOffset+16);
    readOffset+=20;

    //C4 is 60
    let originalPitch = data[readOffset];  //unsigned byte
    readOffset += 1;
    let pitchCorrection = (data[readOffset] << 24) >> 24; //signed byte
    readOffset += 1;

    let sampleLink = getWord(data, readOffset);
    readOffset += 2;
    let sampleTypeValue = getWord(data, readOffset);
    let sampleType = getSampleType(sampleTypeValue);
    readOffset += 2;

    let sampleData = new Uint8Array(data.subarray(
      samplingData.offset + start * 2,
      samplingData.offset + end   * 2
    ));


    samples.push({
      sampleName,
      /*
      start: start, //obviously 0
      end: end,     //and data length
      */
      startLoop,
      endLoop,
      sampleRate,
      originalPitch,
      pitchCorrection,
      sampleLink,
      sampleType,
      data: sampleData
    });
  }

  return samples;
};

const getShort = (data, offset) => {
  return data[offset] | (data[offset+1] << 8) << 16 >> 16;
}

const parseSFGeneratorWithAmount = (operationIndex, data, offset) => {
    let operation = generatorEnumeratorTable[operationIndex] || "Unknown";
    let description = generatorDescriptionTable[operationIndex] || "Unknown";

    return {
      operation,
      description,
      value: {
        signedAmount: getShort(data, offset),
        lo: data[offset],
        hi: data[offset+1]
      }
    }
}

/*
   It is always a multiple of ten bytes in length, and contains zero or
   more modulators plus a terminal record according to the structure:

   For now I consider presets and instruments to have same logic for modulator parsing.

   struct sfModList {
     SFModulator              sfModSrcOper; //Modulators with sfModAmtSrcOper set to ‘link’ which have no other modulator linked to it are ignored
     SFGenerator              sfModDestOper;
     SHORT                    modAmount;
     SFModulator              sfModAmtSrcOper;
     SFTransform              sfModTransOper;
   };
 */
const parseModChunk = (chunkName, /** @type {ByteArray} */ data, chunk, owners) => {
  chunkTypeValidationCheck(chunkName, chunk.type);
  
  /** @type {number} */
  var readOffset = chunk.offset;
  /** @type {number} */
  var size = chunk.offset + chunk.size;
  /** @type {Array.<Object>} */
  var modulators = [];

  if (chunk.size % 10 !== 0) {
    throw new Error(chunkName + " subchunk MUST have size divisible by 10 but it is " + chunk.size + " !");
  }

  //The terminal record conventionally contains zero in all fields, and is always ignored.
  while (readOffset < size-10) {
    // sfModSrcOper is complex part with no visible value right now
    // 16 bits contain FIVE values
    //  Type  = A 6 bit value specifying the continuity of the controller
    //  P     = Polarity  
    //  D     = Direction
    //  CC    = MIDI Continuous Controller Flag
    //  Index = A 7 bit value specifying the controller source
    //Skipped
    readOffset += 2;

    // sfModDestOper
    let operationIndex = getWord(data, readOffset);
    readOffset += 2;

    let modulator = parseSFGeneratorWithAmount(operationIndex, data, readOffset);
    readOffset += 2;

    // AmtSrcOper
    // Skipped
    readOffset += 2;

    // Trans Oper
    // Skipped
    readOffset += 2;

    modulators.push(modulator);
  }

  return modulators;
};

/*
    It is always a multiple of four bytes in length, and contains one
    or more generators for each preset zone (except a global zone
    containing only modulators) plus a terminal record according to the structure:

    struct sfGenList {
      SFGenerator              sfGenOper;
      genAmountType            genAmount;
    };

    and genAmountType is union.

    typedef struct {
      BYTE              byLo;
      BYTE              byHi;
    } rangesType;

    typedef union {
      rangesType        ranges;
      SHORT             shAmount;
      WORD              wAmount;
    } genAmountType;
 */
const parseGenerators = (/** @type {ByteArray} */ data, chunk) => {
  let readOffset = chunk.offset;
  const size = chunk.offset + chunk.size;
  const generators = [];

  while (readOffset < size-4) {
    let operationIndex = getWord(data, readOffset);
    readOffset += 2;

    let generator = parseSFGeneratorWithAmount(operationIndex, data, readOffset);
    readOffset += 2;

    generators.push(generator);
  }

  return generators;
};

const generatorEnumeratorTable = [
  'startAddrsOffset',
  'endAddrsOffset',
  'startloopAddrsOffset',
  'endloopAddrsOffset',
  'startAddrsCoarseOffset',
  'modLfoToPitch',
  'vibLfoToPitch',
  'modEnvToPitch',
  'initialFilterFc',
  'initialFilterQ',
  'modLfoToFilterFc',
  'modEnvToFilterFc',
  'endAddrsCoarseOffset',
  'modLfoToVolume',
  undefined, // 14
  'chorusEffectsSend',
  'reverbEffectsSend',
  'pan',
  undefined,
  undefined,
  undefined, // 18,19,20
  'delayModLFO',
  'freqModLFO',
  'delayVibLFO',
  'freqVibLFO',
  'delayModEnv',
  'attackModEnv',
  'holdModEnv',
  'decayModEnv',
  'sustainModEnv',
  'releaseModEnv',
  'keynumToModEnvHold',
  'keynumToModEnvDecay',
  'delayVolEnv',
  'attackVolEnv',
  'holdVolEnv',
  'decayVolEnv',
  'sustainVolEnv',
  'releaseVolEnv',
  'keynumToVolEnvHold',
  'keynumToVolEnvDecay',
  'instrument',
  undefined, // 42
  'keyRange',
  'velRange',
  'startloopAddrsCoarseOffset',
  'keynum',
  'velocity',
  'initialAttenuation',
  undefined, // 49
  'endloopAddrsCoarseOffset',
  'coarseTune',
  'fineTune',
  'sampleID',
  'sampleModes',
  undefined, // 55
  'scaleTuning',
  'exclusiveClass',
  'overridingRootKey'
];

const generatorDescriptionTable = [

    "startAddrsOffset - The offset, in sample data points, beyond the Start sample header parameter to the first sample data point to be played for this instrument. For example, if Start were 7 and startAddrOffset were 2, the first sample data point played would be sample data point 9.",

    "endAddrsOffset - The offset, in sample sample data points, beyond the End sample header parameter to the last sample data point to be played for this instrument. For example, if End were 17 and endAddrOffset were -2, the last sample data point played would be sample data point 15.",

    "startloopAddrsOffset - The offset, in sample data points, beyond the Startloop sample header parameter to the first sample data point to be repeated in the loop for this instrument. For example, if Startloop were 10 and startloopAddrsOffset were -1, the first repeated loop sample data point would be sample data point 9.",

    "endloopAddrsOffset - The offset, in sample data points, beyond the Endloop sample header parameter to the sample data point considered equivalent to the Startloop sample data point for the loop for this instrument. For example, if Endloop were 15 and endloopAddrsOffset were 2, sample data point 17 would be considered equivalent to the Startloop sample data point, and hence sample data point 16 would effectively precede Startloop during looping.",

    "startAddrsCoarseOffset - The offset, in 32768 sample data point increments beyond the Start sample header parameter and the first sample data point to be played in this instrument. This parameter is added to the startAddrsOffset parameter. For example, if Start were 5, startAddrsOffset were 3 and startAddrsCoarseOffset were 2, the first sample data point played would be sample data point 65544.",

    "modLfoToPitch - This is the degree, in cents, to which a full scale excursion of the Modulation LFO will influence pitch. A positive value indicates a positive LFO excursion increases pitch; a negative value indicates a positive excursion decreases pitch. Pitch is always modified logarithmically, that is the deviation is in cents, semitones, and octaves rather than in Hz. For example, a value of 100 indicates that the pitch will first rise 1 semitone, then fall one semitone.",

    "vibLfoToPitch - This is the degree, in cents, to which a full scale excursion of the Vibrato LFO will influence pitch. A positive value indicates a positive LFO excursion increases pitch; a negative value indicates a positiveexcursion decreases pitch. Pitch is always modified logarithmically, that is the deviation is in cents, semitones, and octaves rather than in Hz. For example, a value of 100 indicates that the pitch will first rise 1 semitone, then fall one semitone.",

    "modEnvToPitch - This is the degree, in cents, to which a full scale excursion of the Modulation Envelope will influence pitch. A positive value indicates an increase in pitch; a negative value indicates a decrease in pitch. Pitch is always modified logarithmically, that is the deviation is in cents, semitones, and octaves rather than in Hz. For example, a value of 100 indicates that the pitch will rise 1 semitone at the envelope peak.",

    "initialFilterFc - This is the cutoff and resonant frequency of the lowpass filter in absolute cent units. The lowpass filter is defined as a second order resonant pole pair whose pole frequency in Hz is defined by the InitialFilter Cutoff parameter. When the cutoff frequency exceeds 20kHz and the Q (resonance) of the filter is zero, the filter does not affect the signal.",

    "initialFilterQ - This is the height above DC gain in centibels which the filter resonance exhibits at the cutoff frequency. A value of zero or less indicates the filter is not resonant; the gain at the cutoff frequency (pole angle) maybe less than zero when zero is specified. The filter gain at DC is also affected by this parameter such that the gain at DC is reduced by half the specified gain. For example, for a value of 100, the filter gain at DC would be 5 dB below unity gain, and the height of the resonant peak would be 10 dB above the DC gain, or 5 dB above unity gain. Note also that if initialFilterQ is set to zero or less and the cutoff frequency exceeds 20 kHz, then the filter response is flat and unity gain.",

    "modLfoToFilterFc - This is the degree, in cents, to which a full scale excursion of the Modulation LFO will influence filter cutoff frequency. A positive number indicates a positive LFO excursion increases cutoff frequency; a negative number indicates a positive excursion decreases cutoff frequency. Filter cutoff frequency is always modified logarithmically, that is the deviation is in cents, semitones, and octaves rather than in Hz. For example, a value of 1200 indicates that the cutoff frequency will first rise 1 octave, then fall one octave.",

    "modEnvToFilterFc - This is the degree, in cents, to which a full scale excursion of the Modulation Envelope will influence filter cutoff frequency. A positive number indicates an increase in cutoff frequency; a negative number indicates a decrease in filter cutoff frequency. Filter cutoff frequency is always modified logarithmically, that is the deviation is in cents,semitones, and octaves rather than in Hz. For example, a value of 1000 indicates that the cutoff frequency will rise one octave at the envelope attack peak.",

    "endAddrsCoarseOffset - The offset, in 32768 sample data point increments beyond the Endsample header parameter and the last sample data point to be played in this instrument. This parameter is added to the endAddrsOffset parameter. For example, if End were 65536, startAddrsOffset were -3 and startAddrsCoarseOffset were -1, the last sample data point played would be sample data point 32765.",

    "modLfoToVolume - This is the degree, in centibels, to which a full scale excursion of the Modulation LFO will influence volume. A positive number indicates a positive LFO excursion increases volume; a negative number indicates a positive excursion decreases volume. Volume is always modified logarithmically, that is the deviation is in decibels rather than in linear amplitude. For example, a value of 100 indicates that the volume will first rise ten dB, then fall ten dB.",

    "unused1 - Unused, reserved. Should be ignored if encountered .",

    "chorusEffectsSend - This is the degree, in 0.1% units, to which the audio output of the note is sent to the chorus effects processor. A value of 0% or less indicates no signal is sent from this note; a value of 100% or more indicates the note is sent at full level. Note that this parameter has no effect on the amount of this signal sent to the \"dry\" or unprocessed portion of the output. For example, a value of 250 indicates that the signal is sent at 25% of full level (attenuation of 12 dB from full level) to the chorus effects processor.",

    "reverbEffectsSend - This is the degree, in 0.1% units, to which the audio output of the note is sent to the reverb effects processor. A value of 0% or less indicates no signal is sent from this note; a value of 100% or more indicates the note is sent at full level. Note that this parameter has no effect on the amount of this signal sent to the \"dry\" or unprocessed portion of the output. For example, a value of 250 indicates that the signal is sent at 25% of full level (attenuation of 12 dB from full level) to the reverb effects processor.",

    "pan - This is the degree, in 0.1% units, to which the \"dry\" audio output of the note is positioned to the left or right output. A value of -50% or less indicates the signal is sent entirely to the left output and not sent to the right output; a value of +50% or more indicates the note is sent entirely to the right and not sent to the left. A value of zero places the signal centered between left and right. For example, a value of -250 indicates that the signal is sent at 75% of full level to the left output and 25% of full level to the right output.",

    "unused2 - Unused, reserved. Should be ignored if encountered.",

    "unused3 - Unused, reserved. Should be ignored if encountered.",

    "unused4 - Unused, reserved. Should be ignored if encountered.",

    "delayModLFO - This is the delay time, in absolute timecents, from key on until the Modulation LFO begins its upward ramp from zero value. A value of 0 indicates a 1 second delay. A negative value indicates a delay less than one second and a positive value a delay longer than one second. The most negative number (-32768) conventionally indicates no delay. For example, a delay of 10 msec would be 1200log2(.01) = -7973.",

    "freqModLFO - This is the frequency, in absolute cents, of the Modulation LFO's triangular period. A value of zero indicates a frequency of 8.176 Hz. A negative value indicates a frequency less than 8.176 Hz; a positive value a frequency greater than 8.176 Hz. For example, a frequency of 10 mHz would be 1200log2(.01/8.176) = -11610.",

    "delayVibLFO - This is the delay time, in absolute timecents, from key on until the Vibrato LFO begins its upward ramp from zero value. A value of 0 indicates a 1 second delay. A negative value indicates a delay less than one second; a positive value a delay longer than one second. The most negative number (-32768) conventionally indicates no delay. For example, a delay of 10 msec would be 1200log2(.01) = -7973.",

    "freqVibLFO - This is the frequency, in absolute cents, of the Vibrato LFO's triangular period. A value of zero indicates a frequency of 8.176 Hz. A negative value indicates a frequency less than 8.176 Hz; a positive value a frequency greater than 8.176 Hz. For example, a frequency of 10 mHz would be 1200log2(.01/8.176) = -11610.",

    "delayModEnv - This is the delay time, in absolute timecents, between key on and the start of the attack phase of the Modulation envelope. A value of 0 indicates a 1 second delay. A negative value indicates a delay less than one second; a positive value a delay longer than one second. The most negative number (-32768) conventionally indicates no delay. For example, a delay of 10 msec would be 1200log2(.01) = -7973.",

    "attackModEnv - This is the time, in absolute timecents, from the end of the Modulation Envelope Delay Time until the point at which the Modulation Envelope value reaches its peak. Note that the attack is \"convex\"; the curve is nominally such that when applied to a decibel or semitone parameter, the result is linear in amplitude or Hz respectively. A value of 0 indicates a 1 second attack time. A negative value indicates a time less than one second; a positive value a time longer than one second. The most negative number (-32768) conventionally indicates instantaneous attack. For example, an attack time of 10 msec would be 1200log2(.01) = -7973.",

    "holdModEnv - This is the time, in absolute timecents, from the end of the attack phaseto the entry into decay phase, during which the envelope value is held at its peak. A value of 0 indicates a 1 second hold time. A negative value indicates a time less than one second; a positive value a time longer than one second. The most negative number (-32768) conventionally indicates no hold phase. For example, a hold time of 10 msec would be 1200log2(.01) = -7973.",

    "decayModEnv - This is the time, in absolute timecents, for a 100% change in the Modulation Envelope value during decay phase. For the Modulation Envelope, the decay phase linearly ramps toward the sustain level. If the sustain level were zero, the Modulation Envelope Decay Time would be the time spent in decay phase. A value of 0 indicates a 1 second decay time for a zero-sustain level. A negative value indicates a time less than one second; a positive value a time longer than one second. For example, a decay time of 10 msec would be 1200log2(.01) = -7973.",

    "sustainModEnv - This is the decrease in level, expressed in 0.1% units, to which the Modulation Envelope value ramps during the decay phase. For the Modulation Envelope, the sustain level is properly expressed in percentof full scale. Because the volume envelope sustain level is expressed as an attenuation from full scale, the sustain level is analogously expressed as a decrease from full scale. A value of 0 indicates the sustain level is full level; this implies a zero duration of decay phase regardless of decay time. A positive value indicates a decay to the corresponding level. Values less than zero are to be interpreted as zero; values above 1000 are to be interpreted as 1000. For example, a sustain level which corresponds to an absolute value 40% of peak would be 600.",

    "releaseModEnv - This is the time, in absolute timecents, for a 100% change in the Modulation Envelope value during release phase. For the Modulation Envelope, the release phase linearly ramps toward zero from the currentlevel. If the current level were full scale, the Modulation Envelope Release Time would be the time spent in release phase until zero valuewere reached. A value of 0 indicates a 1 second decay time for a release from full level. A negative value indicates a time less than one second; a positive value a time longer than one second. For example, a release time of 10 msec would be 1200log2(.01) = -7973.",

    "keynumToModEnvHold - This is the degree, in timecents per KeyNumber units, to which the holdtime of the Modulation Envelope is decreased by increasing MIDI key number. The hold time at key number 60 is always unchanged. The unit scaling is such that a value of 100 provides a hold time which tracks the keyboard; that is, an upward octave causes the hold time to halve. For example, if the Modulation Envelope Hold Time were -7973 = 10 msec and the Key Number to Mod Env Hold were 50 when keynumber 36 was played, the hold time would be 20 msec.",

    "keynumToModEnvDecay - This is the degree, in timecents per KeyNumber units, to which the holdtime of the Modulation Envelope is decreased by increasing MIDI key number. The hold time at key number 60 is always unchanged. The unit scaling is such that a value of 100 provides a hold time that tracks the keyboard; that is, an upward octave causes the hold time to halve. For example, if the Modulation Envelope Hold Time were -7973 = 10 msec and the Key Number to Mod Env Hold were 50 when key number36 was played, the hold time would be 20 msec.",

    "delayVolEnv - This is the delay time, in absolute timecents, between key on and the start of the attack phase of the Volume envelope. A value of 0 indicates a 1 second delay. A negative value indicates a delay less than one second; a positive value a delay longer than one second. The most negative number (-32768) conventionally indicates no delay. For example, a delay of 10 msec would be 1200log2(.01) = -7973.",

    "attackVolEnv - This is the time, in absolute timecents, from the end of the VolumeEnvelope Delay Time until the point at which the Volume Envelope value reaches its peak. Note that the attack is \"convex\"; the curve is nominally such that when applied to the decibel volume parameter, the result is linear in amplitude. A value of 0 indicates a 1 second attacktime. A negative value indicates a time less than one second; a positive value a time longer than one second. The most negative number (-32768) conventionally indicates instantaneous attack. For example, an attack time of 10 msec would be 1200log2(.01) = -7973.",

    "holdVolEnv - This is the time, in absolute timecents, from the end of the attack phaseto the entry into decay phase, during which the Volume envelope value is held at its peak. A value of 0 indicates a 1 second hold time. A negative value indicates a time less than one second; a positive value a time longer than one second. The most negative number (-32768) conventionally indicates no hold phase. For example, a hold time of 10 msec would be 1200log2(.01) = -7973.",

    "decayVolEnv - This is the time, in absolute timecents, for a 100% change in the Volume Envelope value during decay phase. For the Volume Envelope, the decay phase linearly ramps toward the sustain level, causing a constant dB change for each time unit. If the sustain level were -100dB, the Volume Envelope Decay Time would be the time spent in decay phase. A value of 0 indicates a 1-second decay time for a zero-sustain level. A negative value indicates a time less than one second; a positive value a time longer than one second. For example, a decay time of 10 msec would be 1200log2(.01) = -7973.",

    "sustainVolEnv - This is the decrease in level, expressed in centibels, to which the Volume Envelope value ramps during the decay phase. For the Volume Envelope, the sustain level is best expressed in centibels of attenuation from full scale. A value of 0 indicates the sustain level is full level; this implies a zero duration of decay phase regardless of decay time. A positive value indicates a decay to the corresponding level. Values less than zero are to be interpreted as zero; conventionally 1000 indicates full attenuation. For example, a sustain level which corresponds to an absolute value 12dB below of peak would be 120.",

    "releaseVolEnv - This is the time, in absolute timecents, for a 100% change in the Volume Envelope value during release phase. For the Volume Envelope, the release phase linearly ramps toward zero from the current level, causing a constant dB change for each time unit. If the current level were full scale, the Volume Envelope Release Time would be the time spent in release phase until 100dB attenuation were reached. A value of 0 indicates a 1-second decay time for a release from full level. A negative value indicates a time less than one second; a positive valuea time longer than one second. For example, a release time of 10 msec would be 1200log2(.01) = -7973.",

    "keynumToVolEnvHold - This is the degree, in timecents per KeyNumber units, to which the hold time of the Volume Envelope is decreased by increasing MIDI key number. The hold time at key number 60 is always unchanged. The unit scaling is such that a value of 100 provides a hold time which tracks the keyboard; that is, an upward octave causes the hold time to halve. For example, if the Volume Envelope Hold Time were -7973 = 10 msec and the Key Number to Vol Env Hold were 50 when keynumber 36 was played, the hold time would be 20 msec.",

    "keynumToVolEnvDecay - This is the degree, in timecents per KeyNumber units, to which the hold time of the Volume Envelope is decreased by increasing MIDI key number. The hold time at key number 60 is always unchanged. The unit scaling is such that a value of 100 provides a hold time that tracks the keyboard; that is, an upward octave causes the hold time to halve. For example, if the Volume Envelope Hold Time were -7973 = 10 msec and the Key Number to Vol Env Hold were 50 when key number 36 was played, the hold time would be 20 msec.",

    "instrument - This is the index into the INST sub-chunk providing the instrument to be used for the current preset zone. A value of zero indicates the first instrument in the list. The value should never exceed two less than the size of the instrument list. The instrument enumerator is the terminal generator for PGEN zones. As such, it should only appear in the PGEN sub-chunk, and it must appear as the last generator enumerator in all but the global preset zone.",

    "reserved1 - Unused, reserved. Should be ignored if encountered.",

    "keyRange - This is the minimum and maximum MIDI key number values for which this preset zone or instrument zone is active. The LS byte indicates the highest and the MS byte the lowest valid key. The keyRange enumerator is optional, but when it does appear, it must be the first generator in the zone generator list.",

    "velRange - This is the minimum and maximum MIDI velocity values for which this preset zone or instrument zone is active. The LS byte indicates the highest and the MS byte the lowest valid velocity. The velRange enumerator is optional, but when it does appear, it must be preceded only by keyRange in the zone generator list.",

    "startloopAddrsCoarseOffset - The offset, in 32768 sample data point increments beyond the Startloop sample header parameter and the first sample data point to be repeated in this instrument's loop. This parameter is added to the startloopAddrsOffset parameter. For example, if Startloop were 5, startloopAddrsOffset were 3 and startAddrsCoarseOffset were 2, the first sample data point in the loop would be sample data point 65544.",

    "keynum - This enumerator forces the MIDI key number to effectively be interpreted as the value given. This generator can only appear at the instrument level. Valid values are from 0 to 127.",

    "velocity - This enumerator forces the MIDI velocity to effectively be interpreted as the value given. This generator can only appear at the instrument level. Valid values are from 0 to 127.",

    "initialAttenuation - This is the attenuation, in centibels, by which a note is attenuated below full scale. A value of zero indicates no attenuation; the note will be played at full scale. For example, a value of 60 indicates the note will be played at 6 dB below full scale for the note.",

    "reserved2 - Unused, reserved. Should be ignored if encountered.",

    "endloopAddrsCoarseOffset - The offset, in 32768 sample data point increments beyond the Endloop sample header parameter to the sample data point considered equivalent to the Startloop sample data point for the loop for this instrument. This parameter is added to the endloopAddrsOffset parameter. For example, if Endloop were 5, endloopAddrsOffset were 3 and endAddrsCoarseOffset were 2, sample data point 65544 would be considered equivalent to the Startloop sample data point, and hence sample data point 65543 would effectively precede Startloop during looping.",

    "coarseTune - This is a pitch offset, in semitones, which should be applied to the note. A positive value indicates the sound is reproduced at a higher pitch; a negative value indicates a lower pitch. For example, a Coarse Tune value of -4 would cause the sound to be reproduced four semitones flat.",

    "fineTune - This is a pitch offset, in cents, which should be applied to the note. It is additive with coarseTune. A positive value indicates the sound is reproduced at a higher pitch; a negative value indicates a lower pitch. For example, a Fine Tuning value of -5 would cause the sound to be reproduced five cents flat.",

    "sampleID - This is the index into the SHDR sub-chunk providing the sample to be used for the current instrument zone. A value of zero indicates the first sample in the list. The value should never exceed two less than the size of the sample list. The sampleID enumerator is the terminal generator for IGEN zones. As such, it should only appear in the IGEN subSoundFont chunk, and it must appear as the last generator enumerator in all but the global zone.",

    "sampleModes - This enumerator indicates a value which gives a variety of Boolean flags describing the sample for the current instrument zone. The sampleModes should only appear in the IGEN sub-chunk, and should not appear in the global zone. The two LS bits of the value indicate the type of loop in the sample:"+
    "\n0 indicates a sound reproduced with no loop,"+
    "\n1 indicates a sound which loops continuously,"+
    "\n2 is unused but should be interpreted as indicating no loop, and"+
    "\n3 indicates a sound which loops for the duration of key depression then proceeds to play the remainder of the sample.",

    "reserved3 - Unused, reserved. Should be ignored if encountered.",

    "scaleTuning - This parameter represents the degree to which MIDI key number influences pitch. A value of zero indicates that MIDI key number has no effect on pitch; a value of 100 represents the usual tempered semitone scale.",

    "exclusiveClass - This parameter provides the capability for a key depression in a given instrument to terminate the playback of other instruments. This is particularly useful for percussive instruments such as a hi-hat cymbal. An exclusive class value of zero indicates no exclusive class; no special action is taken. Any other value indicates that when this note isinitiated, any other sounding note with the same exclusive class value should be rapidly terminated. The exclusive class generator can only appear at the instrument level. The scope of the exclusive class is the entire preset. In other words, any other instrument zone within the same preset holding a corresponding exclusive class will be terminated.",

    "overridingRootKey - This parameter represents the MIDI key number at which the sample is to be played back at its original sample rate. If not present, or if present with a value of -1, then the sample header parameter OriginalKey is used in its place. If it is present in the range 0-127, then the indicated key number will cause the sample to be played back at its sample header Sample Rate. For example, if the sample were a recording of a piano middle C (Original Key = 60) at a sample rate of 22.050 kHz, and Root Key were set to 69, then playing MIDI key number 69 (A above middle C) would cause a piano note of pitch middle C to be heard. "
];

export default parseSF2;