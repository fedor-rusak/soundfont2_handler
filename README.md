# SoundFont2_Handler - pure JS implementation (with whistles!)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

This is node-based app with default soundFont2 file that allows parsing midi-sound-bank and playing audio sample in browser.

It also contains a script that allows extracting a sample in WAV format.

Now by default it saves played sound on your local file system.

As a bonus you can play a sound via audio html tag.

# Requirements

Tested in Win10 and Node 12.16.2

# How to use

Before using please unzip archive in public/soundfonts. Github does not allow files bigger than 100Mb.

To extract note in *note.wav* file do this from home folder:

```
npm run extract
```

To start a web-app on *localhost:3000* do this:

```
npm start
```