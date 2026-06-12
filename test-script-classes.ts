const mongoose = require('mongoose');
const url = 'YOUR_MONGODB_URI';
mongoose.connect(url).then(async () => {
  const ScheduledClass = require('./src/models/scheduledClass').default;
  const classes = await ScheduledClass.find({});
  console.log('Total scheduled classes:', classes.length);
  classes.forEach(c => console.log('Class StartTime:', c.startTime.toISOString()));
  process.exit(0);
});
