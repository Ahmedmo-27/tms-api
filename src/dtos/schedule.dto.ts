import { IScheduledClass } from "../models/scheduledClass";
import { IClass } from "../models/class";

export function mapScheduledClassDTO(
  scheduledClasses: IScheduledClass[],
  classMap: Map<string, IClass>
) {
  return scheduledClasses.map((sc) => {
    const classInfo = classMap.get(sc.cid.toString());
    return {
      id: sc._id,
      className: classInfo?.title ?? "",
      category: classInfo?.category ?? "",
      startTime: sc.startTime,
      endTime: sc.endTime,
      availableSlots: sc.availableSlots,
      locations: classInfo?.locations ?? [],
      price: classInfo?.price ?? 0,
    };
  });
}
