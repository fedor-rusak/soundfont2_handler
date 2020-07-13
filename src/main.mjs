import express from 'express';
import multer from 'multer';
import fs from 'fs';

const UPLOAD_TEMPORARY_FOLDER = "tmp";
const FINAL_SOUND_FOLDER = "saved_sounds";
if (!fs.existsSync(FINAL_SOUND_FOLDER)){
    fs.mkdirSync(FINAL_SOUND_FOLDER);
}

const app = express();
const uploadHandler = new multer({dest: UPLOAD_TEMPORARY_FOLDER});
const port = 3000;

app.use(express.static('public'));

app.post('/file_upload', uploadHandler.single('audio_data'), function (req, res, next) {
	try {
		let oldFilePath = req.file.path;
		let newFilePath = FINAL_SOUND_FOLDER + "/" + req.file.originalname;

		fs.renameSync(oldFilePath, newFilePath);
	}
	catch(e) {
		next(e);
		return
	}

	res.send('File saved!')
})

app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));
