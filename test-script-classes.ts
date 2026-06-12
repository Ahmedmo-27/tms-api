const mongoose = require('mongoose');
const url = 'mongodb+srv://omar-tolan:q47gSAsN4mGZk3U@cluster0.hftng.mongodb.net/test';
mongoose.connect(url).then(async () => {
  const ScheduledClass = require('./src/models/scheduledClass').default;
  const classes = await ScheduledClass.find({});
  console.log('Total scheduled classes:', classes.length);
  classes.forEach(c => console.log('Class StartTime:', c.startTime.toISOString()));
  process.exit(0);
});
