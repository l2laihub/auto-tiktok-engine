import { Composition } from 'remotion';
import { BeforeAfterReveal, type RevealProps } from './compositions/BeforeAfterReveal';
import { TipsEducational, type TipsProps } from './compositions/TipsEducational';
import { VIDEO, createRevealTiming, createTipsTiming } from './config';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Template A: Before/After Reveal (supports multi-pair) */}
      <Composition
        id="BeforeAfterReveal"
        component={BeforeAfterReveal as React.FC}
        calculateMetadata={({ props }) => {
          const typedProps = props as unknown as RevealProps;
          const pairCount = typedProps.imagePairs?.length || 1;
          const timing = createRevealTiming(pairCount);
          return {
            durationInFrames: timing.totalDuration,
            fps: VIDEO.fps,
            width: VIDEO.width,
            height: VIDEO.height,
          };
        }}
        durationInFrames={createRevealTiming(3).totalDuration}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{
          hookText: 'These photos sat in a drawer\nfor decades...',
          imagePairs: [
            {
              beforeImageSrc: 'https://placehold.co/1080x1920/333/666?text=Before+1',
              afterImageSrc: 'https://placehold.co/1080x1920/667/999?text=After+1',
              photoEra: '1960s',
            },
            {
              beforeImageSrc: 'https://placehold.co/1080x1920/444/777?text=Before+2',
              afterImageSrc: 'https://placehold.co/1080x1920/778/AAA?text=After+2',
              photoEra: '1970s',
            },
            {
              beforeImageSrc: 'https://placehold.co/1080x1920/555/888?text=Before+3',
              afterImageSrc: 'https://placehold.co/1080x1920/889/BBB?text=After+3',
              photoEra: '1950s',
            },
          ],
          musicFile: undefined,
          audioVolume: 0.6,
          slogan: 'Honor them in every pixel.',
        } satisfies RevealProps}
      />

      {/* Template B: Tips/Educational (supports multi-tip) */}
      <Composition
        id="TipsEducational"
        component={TipsEducational as React.FC}
        calculateMetadata={({ props }) => {
          const typedProps = props as unknown as TipsProps;
          const tipCount = typedProps.tips?.length || 1;
          const timing = createTipsTiming(tipCount);
          return {
            durationInFrames: timing.totalDuration,
            fps: VIDEO.fps,
            width: VIDEO.width,
            height: VIDEO.height,
          };
        }}
        durationInFrames={createTipsTiming(2).totalDuration}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{
          hookText: 'Why do AI-restored\nfaces look wrong?',
          tips: [
            {
              tipTitle: 'Face preservation is the hardest part',
              tipBody:
                'Most AI models distort facial features during restoration. After 100+ prompt iterations, we found that explicit identity anchoring reduces face drift by 73%.',
              tipIcon: '🧬',
              tipImageSrc: 'https://placehold.co/1080x1920/2a2440/9988bb?text=Tip+1+bg',
              tipImages: [
                'https://placehold.co/1080x1920/40242a/bb8899?text=Tip+1+broll+a',
                'https://placehold.co/1080x1920/24402a/88bb99?text=Tip+1+broll+b',
              ],
            },
            {
              tipTitle: 'Color accuracy matters more than resolution',
              tipBody:
                'Upscaling a photo 4x means nothing if the skin tones are wrong. Start with color correction before any AI enhancement.',
              tipIcon: '🎨',
              tipImageSrc: 'https://placehold.co/1080x1920/402a24/bb9988?text=Tip+2+bg',
            },
          ],
          takeaway: 'Anchor the face first,\nrestore everything else second',
          musicFile: undefined,
          audioVolume: 0.5,
          slogan: 'Every photo tells their story.',
        } satisfies TipsProps}
      />
    </>
  );
};
