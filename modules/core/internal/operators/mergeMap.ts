import { ObservableInput, Operation, FOType, Sink, SinkArg } from '../types';
import { Observable, sourceAsObservable } from '../Observable';
import { Subscription } from '../Subscription';
import { from } from '../create/from';

export function mergeMap<T, R>(
  project: (value: T, index: number) => ObservableInput<R>,
  concurrent = Number.POSITIVE_INFINITY,
): Operation<T, R> {
  return (source: Observable<T>) =>
    sourceAsObservable((type: FOType, dest: Sink<R>) => {
      if (type === FOType.SUBSCRIBE) {
        let subs: Subscription;
        let counter = 0;
        let active = 0;
        let outerComplete = false;
        const buffer: Array<{outerValue: T, outerIndex: number}> = [];

        let startNextInner: () => void;
        startNextInner = () => {
          while (buffer.length > 0 && active++ < concurrent) {
            const { outerValue, outerIndex } = buffer.shift();
            let innerCounter = 0;
            let innerSource: Observable<R>;
            try {
              innerSource = from(project(outerValue, outerIndex));
            } catch (err) {
              dest(FOType.ERROR, err);
              subs.unsubscribe();
              return;
            }

            let innerSub: Subscription;
            innerSource(FOType.SUBSCRIBE, (type: FOType, v: SinkArg<R>) => {
              switch (type) {
                case FOType.SUBSCRIBE:
                  innerSub = v;
                  subs.add(innerSub);
                  dest(FOType.SUBSCRIBE, subs);
                  break;
                case FOType.NEXT:
                  dest(FOType.NEXT, v);
                  break;
                case FOType.ERROR:
                  dest(FOType.ERROR, v);
                  subs.unsubscribe();
                  break;
                case FOType.COMPLETE:
                  active--;
                  innerSub.unsubscribe();
                  if (buffer.length > 0) {
                    startNextInner();
                  } else {
                    if (outerComplete && active === 0) {
                      dest(FOType.COMPLETE, undefined);
                    }
                  }
                default:
              }
            });
          }
        }

        source(type, (t: FOType, v: SinkArg<T>) => {
          switch (t) {
            case FOType.SUBSCRIBE:
              subs = v;
              break;
            case FOType.NEXT:
              let outerIndex = counter++;
              buffer.push({ outerValue: v, outerIndex });
              startNextInner();
              break;
            case FOType.ERROR:
              dest(FOType.ERROR, v);
              subs.unsubscribe();
              break;
            case FOType.COMPLETE:
              outerComplete = true;
              if (buffer.length > 0) {
                startNextInner();
              } else if (active === 0) {
                dest(FOType.COMPLETE, undefined);
                subs.unsubscribe();
              }
              break;
            default:
          }
        });
      }
    });
}