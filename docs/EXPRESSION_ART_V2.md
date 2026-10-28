# 12种细化表情素材

使用内置 image_gen 生成，以原插件 face-ok.png 为人物和画风参考；原五张图保留。最终图集：data/expressions/expression-sheet-v2.png，另导出12张透明PNG供插件路由使用。由共享 lib/mood-expression.js 统一选择，后端接口、心情设置、挂饰头像/大图和生活总览采用同一结果。

提示词摘要：保持蓝紫发、蓝眼、蓝色鲨鱼帽、白色绒边和鲸鱼胸针的原版Q版软绘风格。生成4列3行、相互隔离且有透明留白的12种头像，顺序为欢喜、开心、平常、担心、难过、烦、困倦、难为情、甜蜜、心软、慌、吃醋；无文字、无网格、无背景。保留相同人物比例、画笔和材质，增强小尺寸可读的眉眼嘴与脸红细节。


实际最终编辑提示词（内置 image_gen）：

Edit this 4-column by 3-row transparent expression sheet for clean production sprite extraction. Preserve the same 12 expressions in the exact same reading order and the same character design, fine original anime/chibi style. Crucial correction: scale down EVERY complete portrait including its little emotion marks to occupy at most 72 percent width AND 72 percent height of its equal grid cell. Center each complete portrait inside its cell. Leave a large, completely transparent empty margin around all four sides of EVERY cell, minimum 12 percent of cell width, especially between columns. No portrait, flipper, accent mark, hair, outline or glow may cross the edge of its cell. No neighboring portrait fragments can enter another cell. Exactly 4 columns and 3 rows with equal grid cells. Keep expressions distinct: delighted, happy, neutral, worried; sad, annoyed, sleepy, shy; affectionate, caring, flustered, jealous. Remove any colored pixel fringe or blue glow around silhouettes, clean alpha transparency and smooth clean edges. No text, no grid lines, no backdrop. This is the same blue-haired girl in her fluffy blue shark hood, tiny whale pin, original proportions, matching soft painting and eyes.
