# Timeline 0.4

The playing surface is now: compact key/scale/tempo/style/rhythm controls, visual,
then eight musical blocks. The mixer, scene library and advanced actions sit in a
collapsed section under the timeline. Existing training tools and code editor remain.

Tempo changes the current phrase. Key, scale and style become a new phrase when you
press Apply groove; they do not silently rewrite custom music on selection. There is
one tempo field. Genre selection no longer changes tempo behind the scenes.

Add current phrase saves the editor to the next empty scene and assigns it to the
next empty block. Four source scenes can be reused across eight blocks. Choose saved
scenes with each block's selector, or select Empty. Blocks have equal display width;
their bar counts are shown, so this is a clip-order timeline rather than a proportional
audio waveform editor. Play from here cues any assigned block.

Play timeline snapshots the assigned scenes, skips empty blocks and loops the order.
Transitions use the sequencer's bar clock, and every block begins at bar one. Audio
must start successfully before playback occurs. Each scene plays once, for its full
bar count. The active block highlight follows scheduling, up to the existing 250 ms
lookahead before audible playback. Tail overlap remains possible as with live edits.

Stop chaining leaves the current phrase looping. The main Stop and Kill stop both
chaining and playback. Manual phrase edits, scene launches, changing assignments or
replacing a saved scene stop chaining. Play timeline releases Freeze. Starting a
new arrangement while it plays restarts the chosen sequence on the next bar boundary.
Scene tempo is preserved unless Keep current tempo is enabled in advanced controls.

Set exports are version 2 and include eight block assignments. Version 1 scene files
still import; their timeline begins empty. Sets remain in local browser storage with
an explicit export for backups. Visual libraries and effects are separate. The
arrangement does not add neural sound generation or pretrained musical styles.

Validation: 100 unit tests and production build. Coverage includes correct block
length, skipping empty blocks, looping, cueing, snapshots, old file compatibility,
scene starts at bar one, and actual sequencer note order/timing. DOM order and unique
control IDs checked. Browser rendering and listening still require the Mac preview.
