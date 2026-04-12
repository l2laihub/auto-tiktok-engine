import { Composition } from 'remotion';
import { BeforeAfterReveal, type RevealProps } from './compositions/BeforeAfterReveal';
import { TipsEducational, type TipsProps } from './compositions/TipsEducational';
import { VIDEO, REVEAL_TIMING, TIPS_TIMING } from './config';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Template A: Before/After Reveal */}
      <Composition
        id="BeforeAfterReveal"
        component={BeforeAfterReveal as React.FC}
        durationInFrames={REVEAL_TIMING.totalDuration}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{
          hookText: 'This photo sat in a drawer\nfor 47 years...',
          beforeImageSrc: 'https://placehold.co/1080x1920/333/666?text=Before',
          afterImageSrc: 'https://placehold.co/1080x1920/667/999?text=After',
          photoEra: '1970s',
          musicFile: undefined,
        } satisfies RevealProps}
      />

      {/* Template B: Tips/Educational */}
      <Composition
        id="TipsEducational"
        component={TipsEducational as React.FC}
        durationInFrames={TIPS_TIMING.totalDuration}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{
          hookText: 'Why do AI-restored\nfaces look wrong?',
          tipTitle: 'Face preservation is the hardest part',
          tipBody:
            'Most AI models distort facial features during restoration. After 100+ prompt iterations, we found that explicit identity anchoring in the generation prompt reduces face drift by 73%.',
          takeaway: 'Anchor the face first,\nrestore everything else second',
          tipImageSrc: undefined,
          musicFile: undefined,
        } satisfies TipsProps}
      />
    </>
  );
};
