# Retro: human polish and #1166 gaps (headwear, armor, bust, jaw, toy face)

**Liked**
- Before/after renders from a worktree on the previous PR's head (`ROOT=<worktree>` on one zoom script) made each fix's visual proof one command.
- Timing every stage turned two slow paths (a 1.9 s bust closing, an 850 ms face relax) into config knobs with identical output at a third of the cost.

**Lacked**
- Tests that prove the fix: three versions of the jaw/beard test passed with the fix switched off. Only checking "fails without it" caught that.
- A real-photo fixture. The fit had only been tested on synthetic renders, and one busy-room photo showed auto segmentation losing a dark shirt (0.38 vs 0.83 IoU with a traced mask).

**Learned**
- When a fix changes nothing (a gap over the shoulder), the cause is elsewhere (the plate corners). Treat a no-op as a wrong diagnosis, not a weak fix.
- Weights for a posed warp must be read where the skin is now (posed space), not where it rests; rest-space weights read 0 next to a dropped chin.
- Relief on a smoothed shell goes on after smoothing; subdividing for it needs the smoothing pass counts scaled, or the shell shows more anatomy.

**Longed for**
- A test helper that runs a spec with a named fix disabled and asserts it fails, so "verified to fail without the fix" is routine, not manual.
- A few committed CC0 real photos (with traced masks) for the photo-fit tests.
