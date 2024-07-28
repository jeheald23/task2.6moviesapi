const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { check, validationResult } = require('express-validator');
const Models = require('./models/models.js');
const AWS = require('aws-sdk');

dotenv.config();

const Movies = Models.Movie;
const Users = Models.User;

const app = express();
const process = require('process');

const mongoURI = process.env.MONGO_URI;
console.log('mongoURI', mongoURI);
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

  const corsOptions = {
    origin: 'http://localhost:1234',
    optionsSuccessStatus: 200,
  };
 
app.use(cors(corsOptions));
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));

// Configure AWS SDK to use LocalStack
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  //endpoint: process.env.LOCALSTACK_ENDPOINT,
  s3ForcePathStyle: true,
  region: process.env.AWS_REGION,
});

// Ensure the S3 bucket exists or create it
const ensureBucketExists = async (bucketName) => {
  try {
    await s3.headBucket({ Bucket: bucketName }).promise();
    console.log(`Bucket "${bucketName}" already exists.`);
  } catch (headErr) {
    if (headErr.code === 'NotFound' || headErr.code === 'NoSuchBucket') {
      try {
        await s3.createBucket({ 
          Bucket: bucketName,
          CreateBucketConfiguration: {
            LocationConstraint: ''
          }
        }).promise();
        console.log(`Bucket "${bucketName}" created successfully.`);
      } catch (createErr) {
        console.error('Error creating bucket:', createErr);
      }
    } else {
      console.error('Error checking if bucket exists:', headErr);
    }
  }
};

ensureBucketExists(process.env.S3_BUCKET);

// Endpoint for uploading images to S3
app.post('/upload', express.json(), async (req, res) => {
  const { image, filename, mimetype } = req.body;
  if (!image || !filename || !mimetype) {
    return res.status(400).send('Invalid image data.');
  }

  const buffer = Buffer.from(image, 'base64');
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: `original-images/${Date.now()}_${filename}`,
    Body: buffer,
    ContentType: mimetype,
  };

  try {
    const data = await s3.upload(params).promise();
    res.status(200).json({ imageUrl: data.Location });
  } catch (error) {
    console.error('Error uploading to S3:', error);
    res.status(500).send('Error uploading to S3');
  }
});

// Endpoint to list images from S3
app.get('/images', async (req, res) => {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Prefix: 'thumbnails/',
  };

  try {
    const data = await s3.listObjectsV2(params).promise();
    console.log(data.Contents)
    const imageUrls = data.Contents.map(item => {
      return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${item.Key}`;
    });
    res.status(200).json(imageUrls);
  } catch (error) {
    console.error('Error listing images from S3:', error);
    res.status(500).send('Error listing images from S3');
  }
});

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route to post user information
app.post('/users', async (req, res) => {
  const newUser = new Users(req.body);
  try {
    const savedUser = await newUser.save();
    res.status(201).send(savedUser);
  } catch (err) {
    res.status(400).send(err);
  }
});

// Route to get movies from the database
app.get('/movies', async (req, res) => {
  try {
    const movies = await Movies.find();
    res.status(200).send(movies);
  } catch (err) {
    res.status(400).send(err);
  }
});

// Route to log in a user
app.post('/login', async (req, res) => {
  const { Username, Password } = req.body;
  try {
    const user = await Users.findOne({ Username });
    if (!user || !user.validatePassword(Password)) {
      return res.status(400).send('Invalid username or password.');
    }
    res.status(200).send('Login successful');
  } catch (err) {
    res.status(500).send(err);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
