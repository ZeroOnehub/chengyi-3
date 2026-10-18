"""承艺 3.0 素材预处理。

从 承艺3.0/ 交接文件夹读取原始素材，输出到 chengyi-web/assets/。
- 陶瓷篇章整图：去掉烘焙在图里的文字（改用网页文字），输出 JPEG 底图
- 主体抠图：按颜色/亮度阈值得到带 alpha 的 PNG，用于主体独立运动
- 其余背景转 JPEG/WebP 压缩

运行：python3 tools/prep_assets.py <承艺3.0 文件夹路径>
依赖：pillow numpy scipy
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
import cv2

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
PK = os.path.join(SRC, '承艺-代码实现交接包-樊烨')
PROC = os.path.join(SRC, '过程打包文件')


def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(np.float32)


def save_jpg(arr, path, q=86, max_w=None):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if max_w and im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def fill_holes_normconv(img, hole, dark_only=False):
    """用多尺度归一化卷积把 hole 区域填为周围的颜色（适合暗色雾气背景）。
    dark_only：只用较暗的像素估计，避免主体周围的辉光把填补区染灰。"""
    out = img.copy()
    known = ~hole
    if dark_only:
        L = lum(img)
        known &= L < np.percentile(L[~hole], 88)
    known = known.astype(np.float32)
    remaining = hole.copy()
    for sigma in (3, 6, 12, 24, 48, 96):
        w = ndi.gaussian_filter(known, sigma)
        acc = np.stack([ndi.gaussian_filter(img[..., c] * known, sigma) for c in range(3)], -1)
        est = acc / np.maximum(w[..., None], 1e-4)
        ok = remaining & (w > 0.25)
        out[ok] = est[ok]
        remaining &= ~ok
        if not remaining.any():
            break
    if remaining.any():
        out[remaining] = est[remaining]
    # 加入雾状低频纹理和细噪点，避免填补区过于平滑
    rng = np.random.default_rng(7)
    fog = ndi.gaussian_filter(rng.normal(0, 1, out.shape[:2]).astype(np.float32), 18)
    fog = fog / (np.abs(fog).max() + 1e-6) * (14 if dark_only else 4)
    grain = rng.normal(0, 1.6, out.shape).astype(np.float32)
    out[hole] += grain[hole] + fog[hole][:, None] * np.array([0.7, 1.0, 1.05], np.float32)
    # 羽化接缝
    soft = ndi.gaussian_filter(hole.astype(np.float32), 10.0 if dark_only else 2.0)[..., None]
    soft = np.clip(soft * (1.6 if dark_only else 1.0), 0, 1)
    return img * (1 - soft) + out * soft


def inpaint_plate(img, hole):
    """主体移走后的底图：半分辨率 Telea 修补，保留周围雾气与光晕的走向，再叠细噪点。"""
    h, w = hole.shape
    small = cv2.resize(img.astype(np.uint8), (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    m = cv2.resize(hole.astype(np.uint8) * 255, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), m, 18, cv2.INPAINT_TELEA)
    fill = cv2.cvtColor(fill, cv2.COLOR_BGR2RGB)
    fill = cv2.GaussianBlur(fill, (0, 0), 6)
    fill = cv2.resize(fill, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    rng = np.random.default_rng(3)
    fill += rng.normal(0, 1.8, fill.shape).astype(np.float32)
    soft = ndi.gaussian_filter(hole.astype(np.float32), 8.0)[..., None]
    soft = np.clip(soft * 1.5, 0, 1)
    return img * (1 - soft) + fill * soft


def remove_text(img, boxes, thr=16, grow=3):
    """boxes: [(x0,y0,x1,y1)]，在框内检测比局部背景亮的笔画并填补。"""
    L = lum(img)
    bg = ndi.median_filter(L, size=21)
    mask = np.zeros(L.shape, bool)
    for (x0, y0, x1, y1) in boxes:
        sub = (L[y0:y1, x0:x1] - bg[y0:y1, x0:x1]) > thr
        mask[y0:y1, x0:x1] |= sub
    mask = ndi.binary_dilation(mask, iterations=grow)
    return fill_holes_normconv(img, mask)


def cutout(img, box, thr, close=3, feather=1.2, extra=None, iters=6, gate=None):
    """GrabCut 抠图：box 内亮度高于 thr 的像素作为“可能前景”的初值。返回 RGBA（裁到 box）与整图 mask。"""
    x0, y0, x1, y1 = box
    pad = 24
    X0, Y0 = max(0, x0 - pad), max(0, y0 - pad)
    X1, Y1 = min(img.shape[1], x1 + pad), min(img.shape[0], y1 + pad)
    sub = np.ascontiguousarray(img[Y0:Y1, X0:X1].astype(np.uint8))
    L = lum(sub.astype(np.float32))
    gm = np.full(L.shape, cv2.GC_BGD, np.uint8)
    inner = np.zeros(L.shape, bool)
    inner[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    gm[inner] = cv2.GC_PR_BGD
    fg = inner & (L > thr)
    if extra is not None:
        fg &= extra(sub.astype(np.float32))
    gm[fg] = cv2.GC_PR_FGD
    core = ndi.binary_erosion(ndi.binary_fill_holes(ndi.binary_closing(fg, iterations=4)), iterations=8)
    gm[core] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(sub, cv2.COLOR_RGB2BGR), gm, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    m = (gm == cv2.GC_FGD) | (gm == cv2.GC_PR_FGD)
    if gate is not None:
        m &= gate(sub.astype(np.float32))
    m = ndi.binary_closing(m, iterations=close)
    m = ndi.binary_fill_holes(m)
    lab, n = ndi.label(m)
    if n > 1:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        big = sizes.max()
        m = np.isin(lab, [i + 1 for i in range(n) if sizes[i] >= big * 0.03])
    a = ndi.gaussian_filter(m.astype(np.float32), feather)
    a = np.clip((a - 0.2) / 0.6, 0, 1)
    # 裁回 box
    sl = (slice(y0 - Y0, y1 - Y0), slice(x0 - X0, x1 - X0))
    rgba = np.dstack([sub[sl], (a[sl] * 255).astype(np.uint8)]).astype(np.uint8)
    full = np.zeros(img.shape[:2], bool)
    full[Y0:Y1, X0:X1] = m
    return rgba, full


def save_png(rgba, path):
    im = Image.fromarray(rgba, 'RGBA')
    bb = im.getbbox()
    im.save(path, optimize=True)
    return bb


def main():
    story = os.path.join(OUT, 'story')
    img_out = os.path.join(OUT, 'img')
    os.makedirs(story, exist_ok=True)
    os.makedirs(img_out, exist_ok=True)
    meta = {}

    # 章节序号（顶部）与正文框，坐标基于 1672×941
    TOP = (770, 20, 905, 105)
    text_boxes = {
        '1': [TOP, (1110, 335, 1550, 535)],
        '2': [TOP, (205, 325, 580, 510)],
        '3': [TOP, (995, 325, 1490, 515)],
        '4': [],
        '5': [TOP, (190, 240, 640, 330), (430, 355, 880, 395), (430, 500, 860, 545), (430, 645, 845, 695)],
        '6': [TOP, (120, 290, 570, 490)],
        '7': [(740, 25, 920, 90)],
        '8': [(740, 25, 920, 90)],
        '9': [(740, 35, 930, 105), (145, 195, 280, 650)],
        '9，1': [(740, 35, 930, 105), (145, 195, 280, 650)],
    }
    files = {'5': '5-瓶身放大顶部统一.png'}
    clean = {}
    for k, boxes in text_boxes.items():
        img = load(os.path.join(PROC, files.get(k, k + '.png')))
        if img.shape[1] != 1672:
            img = np.asarray(Image.fromarray(img.astype(np.uint8)).resize((1672, 941), Image.LANCZOS)).astype(np.float32)
        thr = 12 if k in ('9', '9，1') else 16
        c = remove_text(img, boxes, thr=thr) if boxes else img
        clean[k] = c
        name = '9b' if k == '9，1' else k
        save_jpg(c, os.path.join(story, f's{name}.jpg'))

    # 主体抠图：box 与阈值逐张设定
    cut_specs = {
        # 名称: (源, box, 阈值)
        'heap': ('1', (90, 290, 870, 700), 70),
        'clay': ('2', (940, 290, 1410, 730), 85),
        'biscuit': ('3', (385, 225, 750, 730), 80),
        'vase4': ('4', (1030, 280, 1250, 580), 120),
    }
    beige = lambda s: ((s[..., 0] - s[..., 2]) > 6) & (lum(s) > 55)
    for name, (src, box, thr) in cut_specs.items():
        rgba, m = cutout(clean[src], box, thr, gate=beige if name != 'vase4' else None)
        save_png(rgba, os.path.join(story, f'cut-{name}.png'))
        meta[name] = {'src': src, 'x': box[0], 'y': box[1], 'w': box[2] - box[0], 'h': box[3] - box[1]}
        # 底图去主体
        hole = ndi.binary_dilation(m, iterations=26)
        plate = inpaint_plate(clean[src], hole)
        save_jpg(plate, os.path.join(story, f's{src}-plate.jpg'))

    # 图 8 底部的泥土堆（破碎终态的落点），用于“消解归土”逐渐堆积
    rgba, _ = cutout(clean['8'], (560, 680, 960, 900), 95, close=4, gate=beige)
    save_png(rgba, os.path.join(story, 'cut-pile8.png'))
    meta['pile8'] = {'src': '8', 'x': 560, 'y': 680, 'w': 400, 'h': 220}

    # 图 9，1 的土堆：只保留台面以上的土，供逐渐堆积
    b = clean['9，1']
    rgba, _ = cutout(b, (560, 470, 1110, 690), 110, close=3,
                     extra=lambda s: (s[..., 0] - s[..., 2]) > 8, gate=beige)
    save_png(rgba, os.path.join(story, 'cut-heap9.png'))
    meta['heap9'] = {'src': '9b', 'x': 560, 'y': 470, 'w': 550, 'h': 220}

    # ChatGPT 图像：纯黑底上的成品青花瓶，阈值即可干净抠出，供“成器 / 破碎”使用
    v = load(os.path.join(PROC, 'ChatGPT 图像 2026年10月18日 16_31_03.png'))
    a = np.clip((v.max(-1) - 14) / 30, 0, 1)
    m = ndi.binary_fill_holes(a > 0.5)
    a = np.maximum(a, ndi.gaussian_filter(m.astype(np.float32), 1.0))
    rgba = np.dstack([v, a * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    im = im.crop(im.getbbox())
    im.save(os.path.join(story, 'vase-final.png'), optimize=True)
    meta['vaseFinal'] = {'w': im.width, 'h': im.height}

    # 图 7：按成品瓶轮廓（与网页中放置位置一致：606,166 起，434×640）去掉瓶体，瓶后留下光晕
    vx, vy, vw, vh = 606, 166, 434, 640
    al = np.asarray(im.split()[-1].resize((vw, vh), Image.LANCZOS)) > 40
    h7 = np.zeros(clean['7'].shape[:2], bool)
    h7[vy:vy + vh, vx:vx + vw] = al
    h7 = ndi.binary_dilation(h7, iterations=12)
    save_jpg(inpaint_plate(clean['7'], h7), os.path.join(story, 's7-plate.jpg'))

    with open(os.path.join(story, 'cuts.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    # 其余背景
    for src, dst in [
        (os.path.join(PK, 'backgrounds', 'prologue-clean.png'), 'prologue.jpg'),
        (os.path.join(PK, 'backgrounds', 'map-clean.png'), 'map.jpg'),
        (os.path.join(PK, 'backgrounds', 'object-clean.png'), 'object.jpg'),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '04-后背景.png'), 'object-sky.jpg'),
        (os.path.join(PROC, '0.png'), 'studio.jpg'),
    ]:
        save_jpg(load(src), os.path.join(img_out, dst), q=88)
    # 透明分层：缩小后保存 PNG
    for src, dst, w in [
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '03-山地.png'), 'object-hills.png', 1672),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '02-银河光.png'), 'object-river.png', 1672),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '05-前景.png'), 'object-front.png', 1672),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '01-单个物品', '01-青瓷瓶.png'), 'obj-celadon.png', 900),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '01-单个物品', '02-左侧粒子圆饰.png'), 'obj-papercut-particle.png', 900),
        (os.path.join(PK, '青瓷近景-分层PNG-v1', '01-单个物品', '03-右侧粒子饰件.png'), 'obj-filigree-particle.png', 900),
    ]:
        im = Image.open(src).convert('RGBA')
        bb = im.getbbox()
        if bb:
            im = im.crop(bb) if 'obj-' in dst else im
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(os.path.join(img_out, dst), optimize=True)
    # 地图五件物品（原像素，不放大）
    items = os.path.join(PK, '地图五件物品-独立PNG')
    for f, dst in [('01-圆形纹饰.png', 'map-papercut.png'), ('02-编织篮.png', 'map-basket.png'),
                   ('03-人偶.png', 'map-puppet.png'), ('04-青瓷瓶.png', 'map-celadon.png'),
                   ('05-金色饰件.png', 'map-filigree.png')]:
        Image.open(os.path.join(items, f)).save(os.path.join(img_out, dst), optimize=True)
    print('done')


if __name__ == '__main__':
    main()
