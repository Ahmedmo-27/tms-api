import mongoose from 'mongoose';
import User from '../../models/user';
import Member from '../../models/member';
import Package from '../../models/package';
import Class from '../../models/class';
import Schedule from '../../models/schedule';
import ScheduledClass from '../../models/scheduledClass';

export const cleanupDatabase = async () => {
    type AnyModel = mongoose.Model<any>;
    const collections: AnyModel[] = [
        User,
        Member,
        Package,
        Class,
        Schedule,
        ScheduledClass
    ];

    await Promise.all(
        collections.map(collection => collection.deleteMany({}))
    );

    // Clean up any mongoose models that might have been created but not saved
    // This helps prevent memory leaks in tests
    mongoose.modelNames().forEach(modelName => {
        delete mongoose.models[modelName];
    });
};