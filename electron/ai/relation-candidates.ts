const COMMON_SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'

const COMPOUND_SURNAMES = [
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '宇文', '司徒', '司空',
  '令狐', '夏侯', '端木', '南宫', '西门', '独孤', '轩辕', '耶律', '完颜', '赫连', '澹台', '公冶', '宗政',
  '濮阳', '淳于', '单于', '太史', '申屠', '公羊', '闻人', '万俟', '司寇', '呼延', '东郭', '百里', '南门', '东门',
]

const SURNAME_START = new RegExp(`^(?:${COMPOUND_SURNAMES.join('|')}|[${COMMON_SURNAMES}])`)

// 虚词、代词、量词和常见动词。只用于判断开头和结尾，避免把“一”“子”“儿”这类
// 可以出现在人名里的字直接排除。
const START_FUNC =
  /^(?:这|那|哪|什|怎|为|因|所|但|却|就|也|都|还|又|再|很|太|更|最|不|没|有|是|在|和|与|把|被|给|让|从|向|对|到|等|吗|呢|吧|啊|呀|哦|嗯|他|她|我|你|您|们|个|些|此|其|之|于|而|自|己|么|件|位|名|柄|张|只|条|双|座|间|场|次|种|样|般|道|才|定|便|将|要|会|然|来|去|回|当|得|越|入)/

const NUISANCE_SUFFIX =
  /(?:说|道|问|答|喊|叫|笑|看|望|走|站|坐|点|摇|沉|皱|开|回|低|大|去|来|吃|喝|睡|醒|想|知|觉|听|闻|见|做|拿|放|打|杀|推|拉|抱|哭|骂|哼|怒|叹|跪|拜|挥|抬|伸|指|盯|住|应|头|手|眼|脸|身|心|口|声|事|人|们|里|中|上|下|后|前|时|地|得|着|过|的|了|是|在|有|和|与|就|都|也|又|很|最|更|不|没|这|那|个|些|样|般|件|位|名|柄|张|只|条|双|座|间|场|次|微|才|定|便|将|要|会|然|候|边|面|处|日|月|年|两|数|几|多|务|起|下|上|内|外|前|后|着)$/

const STOPWORDS = new Set([
  // 普通代词、虚词和常用词组
  '他说', '她说', '说道', '问道', '笑道', '答道', '点头', '摇头', '沉默', '看着', '望着', '转身', '皱眉', '开口',
  '回答', '低声', '大声', '众人', '大家', '作者', '读者', '自己', '我们', '他们', '她们', '什么', '这个', '那个',
  '已经', '还是', '但是', '因为', '所以', '如果', '就是', '不是', '可以', '没有', '这样', '那样', '以及', '然后',
  '而且', '或者', '最后', '第一', '第二', '第三', '现在', '当时', '此时', '忽然', '突然', '终于', '似乎', '仿佛',
  '知道', '觉得', '看到', '听见', '一个', '一条', '一片', '这座', '那座', '一边', '一声', '有些', '只有', '只是',
  '心中', '眼中', '手中', '面前', '身后', '身边', '脸上', '身上', '地下', '天下', '世间', '时间', '事情', '东西',
  // 身份、称谓和泛称
  '皇帝', '陛下', '皇子', '公主', '太后', '宗师', '大宗师', '大人', '少爷', '姑娘', '公子', '学士', '大学士',
  '提司', '作者', '读者', '人们', '有人', '此人', '那人', '少年', '少女', '老人', '男子', '女子', '孩子', '兄弟',
  '姐妹', '父亲', '母亲', '儿子', '女儿', '妻子', '丈夫', '师父', '老师', '学生', '朋友', '敌人', '对手', '属下',
  '手下', '长老', '掌门', '宗主', '院长', '将军', '城主', '楼主', '阁主', '老板', '掌柜', '小二', '太子', '国师',
  '小人', '丫鬟', '侍女', '侍卫', '护卫', '随从', '弟子', '门生', '家主', '老爷', '老太爷', '老太太', '嬷嬷',
  '太监', '宫女', '官员', '少卿', '知州', '守备', '钦差', '父皇', '老二', '老三', '老妈', '六爷', '皇兄', '兄长',
  // 时间、数量和方位
  '一日', '两天', '三天', '十年', '当年', '今日', '明日', '昨日', '此时', '那时', '后来', '随后', '接着', '多少',
  '许多', '不少', '一些', '一点', '一丝', '一抹', '一声', '一句', '一口', '一阵', '一片', '一道', '一柄', '一把',
  '一只', '一条', '一张', '一双', '一座', '一间', '一场', '一次', '一种', '一样', '一般', '一直', '一起', '两边',
  '万两', '数月', '数日', '各郡', '许久', '多年', '几年', '两年', '三年', '四年', '五年', '十年', '三十年', '四十',
  '五十', '十三', '十几', '数十', '旁边', '两旁', '身边', '身前', '身后', '面前', '手中', '口中', '脚下', '地上',
  '天上', '江湖', '朝廷', '朝堂', '院里', '府里', '城里', '宫里', '宫中',
  // 常见动作、状态和修饰
  '可能', '出来', '起来', '下来', '过来', '回去', '进去', '出去', '一声', '两句', '几句', '微微', '满脸', '件事',
  '句话', '会儿', '子一', '头一', '手一', '眼一', '心中一', '才', '定会', '便会', '呆会', '人会', '然会', '地将',
  '已然', '仍然', '居然', '果然', '总要', '几分', '少许', '强者', '弱者', '高手', '权贵', '大军', '大族', '后宫',
  '龙椅', '长刀', '木门', '房门', '本官', '下官', '卑职', '末将', '微臣', '臣子', '人家', '别人', '二字', '偏生',
  '沉稳', '春闱', '入宫', '出宫', '回京', '离京', '进京', '出京', '回府', '进宫', '别院', '小院', '后院', '前院',
  '屋里', '路上', '门外', '门口', '窗边', '心里', '眼中', '脸上', '身上', '身旁', '面前', '手中', '口中', '脚下',
  '地上', '天上', '院里', '府里', '城里', '宫里', '宫中', '出神', '走神', '养神', '弑君', '储君', '至尊', '神圣',
  '长剑', '短剑', '刀剑', '天子剑', '先帝', '父王', '本王', '老夫', '老娘', '老天爷', '宗室', '天下人',
  // 小说里常见的误报
  '州城', '隐隐', '大部', '年青', '细细', '东家', '洪老', '响起', '别府', '院提', '异国', '二殿', '常寺', '似笑非',
  '小楼', '宫墙', '嘲讽', '长街', '经脉', '门师', '长长', '出使', '耳边', '笠帽', '祭天', '极快', '三处', '颜面',
  '两家', '剑客', '闷响', '顶楼', '极少', '明园', '华园', '苍山', '沙州', '颍州', '范提', '许茂', '石清', '沐风',
  '正使', '正阳门', '考院', '总督府', '镇抚司', '鸿胪寺', '江南水寨', '招商钱庄', '流晶河', '悬空庙', '庆余堂',
  '广信宫', '含光殿', '城门司', '苏州府', '苏州城', '靖王府', '澹州城', '宜贵嫔', '司库', '密院', '愈发', '领军',
  '两边', '敌国', '并未', '纵使', '权臣', '阴险', '面露', '惊天', '弊案', '庆历', '容颜', '院门', '封信', '如山',
  '府门', '铁钎', '出府', '御医', '老妈', '红楼', '领命', '大势', '凶险', '床边', '府邸', '脚尖', '姿式', '怜惜',
  '庙宇', '天光', '开山', '刺入', '大感', '遗书', '推门', '脆响', '大惊', '无语', '极难', '院务', '进门', '回宫',
  '监国', '回澹州', '当范闲', '恨恨', '讷讷', '淡淡', '冷冷', '轻轻', '缓缓', '慢慢', '悄悄', '默默', '静静',
  '匆匆', '悠悠', '怔怔', '呆呆', '愣愣', '痴痴', '喃喃', '狠狠', '牢牢', '紧紧', '深深', '远远', '早早', '刚刚',
  '常常', '渐渐', '连连', '纷纷', '统统', '通通', '步步', '声声', '字字', '句句', '人人', '家家', '处处', '事事',
  '时时', '日日', '夜夜', '年年', '月月', '笑眯眯', '笑吟吟', '咕哝', '掩嘴', '讨好', '闭目', '面带', '惊呼',
  '涌起', '阴寒', '忧色', '正色', '宁神', '费神', '屈尊', '请范', '谁敢', '校官', '府尹', '宗师级', '古剑', '封王',
  '诸君', '师兄', '师姐', '师妹', '师弟', '大少', '二少', '小少', '小公', '大公', '明少', '明老', '夏爷', '曹公',
  '陈老', '秦老', '范兄', '史兄', '侯兄', '林妹妹', '林姐姐', '林二公', '袁梦姑', '桑文姑', '司理理姑', '明六爷',
  '明七公', '明七少', '明家老', '明家少', '范家二少', '范家少', '范大少', '范闲少', '家大少', '费介老', '伯范建',
  '小师姑', '小意', '睁睁', '笑非', '钱庄', '庆律', '一会', '里会', '下会', '怕会', '往京', '下江', '联姻', '作响',
  '角门', '后园', '八品', '大员', '密谍', '老老实', '笑眯', '三年前', '两年前', '一年前', '多年前', '几年前', '半年前',
  '机会', '全部', '理会', '总会', '官司', '家族', '皇族', '主子', '本宫', '内部', '两国', '一部', '朝会', '士子',
  '大江', '出门', '开门', '入京', '陈院', '庆国皇', '山会', '王启', '皇宫', '宫殿', '大殿', '宫门', '城门', '衙门',
  '酒楼', '青楼', '园子', '大门', '帐房', '内宫', '后园', '水寨',
  '真气', '汉子', '孩儿', '专门', '相关', '贵族', '官府', '庄园', '山谷', '铺子', '守城', '堂堂', '贵嫔', '宜贵',
  '子殿', '极殿', '鸿胪', '胪寺', '山门', '楼子', '监宫', '宅子', '性子', '上司', '劲儿', '正门', '无关', '开国',
  '股子', '众官', '平钱庄', '平别院',
])

const ROLE_COMPOUND =
  /(?:皇帝|陛下|大人|姑娘|公子|小姐|少爷|公公|娘娘|侯爷|王爷|老太君|公爷|师爷|老爷|夫人|太太|阁下|殿下|诸位|各位|丫头|小子|家伙|太监|宫女|侍卫|官员|国师|宗师|将军|院长|城主|楼主|阁主|长老|掌门|宗主|师兄|师姐|师妹|师弟|师父|老师|学生|弟子|门生|随从|护卫|侍女|丫鬟)/

const TITLE_SUFFIX = /(?:帝|王|皇|剑|仙|神|魔|佛|圣|尊|君|公|侯|伯|爷|叔|兄|妹|姐|姑|娘|主)$/
const STRONG_TITLE = /(?:帝|剑|王|皇|主)$/
const PERSON_ROLE = /(?:公主|皇子|太子|王爷|侯爷|公爷|大人|将军|国师|宗师|先生|公子|姑娘|小姐|少爷|夫人|娘娘|皇后|太后|殿下|陛下|长老|掌门|宗主)/
const PLACE_SUFFIX = /(?:院|城|国|楼|阁|宫|府|州|郡|县|山|河|江|湖|岛|关|门|教|派|帮|会|盟|族|军|司|部|殿|庙|堂|庄|园|营|寨|谷|峰|岭|原|京)$/
// 地点/组织名里不该夹着“坐在”“站在”这类动作；否则会把整句切成地名。
const PLACE_INTERNAL_STOP = /[的了着过是在有和与就都也又很最更不没这那他她我你您们个些把被给让从向对到为以而但却只已所其此之于等吗呢吧啊呀哦嗯说看望向走站坐点摇笑问答应微才定便将要会然地来去]/
const TECHNIQUE_SUFFIX = /(?:法|术|功|诀|掌|拳|步|阵|经|书|图|谱|曲)$/

const BREAK_CHARS = new Set([
  ...'的了着过是在有和与就都也又很最更不没这那他她我你您们个些把被给让从向对到为以而但却只已所其此之于等吗呢吧啊呀哦嗯一自己么什怎件位名柄张只条双座间场次种样般道说看望向走站坐点摇想知觉听闻见做拿放打杀推拉抱哭骂哼怒叹跪拜挥抬伸指盯住应微才定便将要会然地人上来去上下中里前后时候事头手眼脸身心口声',
])

const EXTEND_CHARS = new Set([...'剑帝皇王后妃仙神魔佛圣尊君公侯伯爷叔兄姐妹姑娘子女儿郎老少宗师尊主'])

function isChineseNameLike(value: string, place = false): boolean {
  const min = 2
  const max = place ? 5 : 4
  if (value.length < min || value.length > max) return false
  if (!/^[一-鿿]+$/.test(value)) return false
  if (STOPWORDS.has(value)) return false
  if (START_FUNC.test(value)) return false
  if (ROLE_COMPOUND.test(value)) return false
  if (place) return PLACE_SUFFIX.test(value) && !PLACE_INTERNAL_STOP.test(value.slice(0, -1))
  // “儿、子、年”可以出现在名字末尾（林婉儿、韩非子、王启年），但常见词已在 STOPWORDS 里排除。
  if (/(?:子|儿|年)$/.test(value) && value.length >= 3) return true
  return !NUISANCE_SUFFIX.test(value)
}

function isPrunableEntity(value: string): boolean {
  if (value.length < 3 || TECHNIQUE_SUFFIX.test(value)) return false
  if (
    PLACE_SUFFIX.test(value) &&
    !START_FUNC.test(value) &&
    !ROLE_COMPOUND.test(value) &&
    !PLACE_INTERNAL_STOP.test(value.slice(0, -1))
  ) {
    return true
  }
  return isChineseNameLike(value)
}

function bump(counts: Map<string, number>, key: string, weight = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + weight)
}

/**
 * 全文章节 + 笔记的本地实体扫描。它不是最终事实来源，只把候选名单和原文片段交给模型核对，
 * 避免只抽主角、把司理理、四顾剑这类中后段配角或称号漏掉。
 *
 * 中文人名经常没有姓氏（四顾剑、苦荷、庆帝），只靠姓氏正则一定会漏。这里用 Intl.Segmenter
 * 把连续的单字段落连成候选，再对“四顾剑法”这类被词库切断的名字做后缀补全；
 * 地点/组织则单独扫描院、城、楼、宫等后缀。
 */
export function extractCharacterCandidates(
  chapterTexts: string[],
  notes: string[] = [],
  limit = 120,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  const rawCounts = new Map<string, number>()
  const textLength = chapterTexts.reduce((sum, text) => sum + text.length, 0) + notes.reduce((sum, text) => sum + text.length, 0)

  const addRaw = (value: string): void => {
    if (value.length >= 2 && value.length <= 5) bump(rawCounts, value)
  }
  const add = (value: string, weight = 1): void => {
    addRaw(value)
    if (isChineseNameLike(value)) bump(counts, value, weight)
  }

  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const consume = (text: string): void => {
    const normalized = text.replace(/\s+/g, ' ')
    const parts = [...segmenter.segment(normalized)]
    let run = ''
    const flush = (): void => {
      if (run.length >= 2) {
        for (let start = 0; start < run.length; start++) {
          for (let len = 2; len <= 4 && start + len <= run.length; len++) {
            add(run.slice(start, start + len))
          }
        }
      }
      run = ''
    }
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (!part?.isWordLike) {
        flush()
        continue
      }
      const word = part.segment
      if (word.length === 1 && !BREAK_CHARS.has(word)) {
        run += word
        const next = parts[index + 1]
        if (next?.isWordLike && next.segment.length >= 2 && EXTEND_CHARS.has(next.segment[0] ?? '')) {
          const extended = run + next.segment[0]
          if (extended.length >= 3) add(extended)
          // 战豆豆：单字段落 + 两字词，拼成完整名字。
          if (next.segment.length === 2 && run.length === 1) add(run + next.segment)
        }
      } else {
        flush()
      }
    }
    flush()
  }

  for (const text of chapterTexts) consume(text)
  for (const text of notes) consume(text)

  // 地点、组织、门派等：用后缀匹配补上 Segmenter 不会拆成人名的那部分。
  for (const text of [...chapterTexts, ...notes]) {
    const normalized = text.replace(/\s+/g, ' ')
    for (const match of normalized.matchAll(/[一-鿿]{2,}/g)) {
      const run = match[0]
      for (let start = 0; start < run.length; start++) {
        for (let len = 2; len <= 5 && start + len <= run.length; len++) {
          const value = run.slice(start, start + len)
          if (!PLACE_SUFFIX.test(value)) continue
          addRaw(value)
          if (isChineseNameLike(value, true)) bump(counts, value)
        }
      }
    }
  }

  const longerSupport = new Map<string, number>()
  for (const [value, count] of rawCounts) {
    if (value.length < 3) continue
    if (!isPrunableEntity(value)) continue
    for (let start = 0; start < value.length; start++) {
      for (let len = 2; len < value.length && start + len <= value.length; len++) {
        const sub = value.slice(start, start + len)
        longerSupport.set(sub, Math.max(longerSupport.get(sub) ?? 0, count))
      }
    }
  }

  const segmentWords = new Map<string, number>()
  for (const text of chapterTexts) {
    for (const part of segmenter.segment(text)) {
      if (!part.isWordLike) continue
      const word = part.segment
      if (word.length >= 2 && word.length <= 4) bump(segmentWords, word)
    }
  }

  const minCount = textLength >= 40_000 ? 5 : 2
  const boostMin = Math.max(10, Math.round(textLength / 20_000))
  const candidates = [...counts.entries()]
    .filter(([name, count]) => count >= minCount && (longerSupport.get(name) ?? 0) < count * 0.5)
    .filter(([name, count]) => {
      // 地点/组织有明确后缀，不因为分词器把它当成普通词就丢掉。
      if (PLACE_SUFFIX.test(name)) return true
      const wordCount = segmentWords.get(name) ?? 0
      return !(wordCount >= 8 && wordCount / count >= 0.5)
    })
    .map(([name, count]) => ({ name, count }))
    .filter(({ name }) => {
      // 丢掉“范闲皱眉”这类以完整人名开头、后面又接了动作的切片。
      for (let len = 2; len < name.length; len++) {
        const prefix = name.slice(0, len)
        const prefixCount = rawCounts.get(prefix) ?? 0
        if (prefixCount >= (counts.get(name) ?? 0) * 3) {
          const tail = name.slice(len)
          return tail.length === 1 && EXTEND_CHARS.has(tail)
        }
      }
      return true
    })

  return candidates
    .map((candidate) => {
      const boost = candidate.count >= boostMin
      const score =
        candidate.count +
        (boost && SURNAME_START.test(candidate.name) ? 30 : 0) +
        (boost && TITLE_SUFFIX.test(candidate.name) ? 100 : 0) +
        (boost && STRONG_TITLE.test(candidate.name) ? 150 : 0) +
        (boost && PERSON_ROLE.test(candidate.name) ? 80 : 0)
      return { ...candidate, score }
    })
    .sort((left, right) => right.score - left.score || right.count - left.count || left.name.length - right.name.length)
    .slice(0, limit)
    .map(({ name, count }) => ({ name, count }))
}

/** 给候选人物抓取少量原文窗口，让模型看到配角在中后段的具体语境。 */
export function candidateSnippets(
  chapterTexts: string[],
  names: string[],
  maxChars = 8_000,
): string {
  const result: string[] = []
  let used = 0
  for (const name of names) {
    const windows: string[] = []
    for (const text of chapterTexts) {
      const normalized = text.replace(/\s+/g, ' ')
      const first = normalized.indexOf(name)
      if (first < 0) continue
      const start = Math.max(0, first - 90)
      windows.push(normalized.slice(start, Math.min(normalized.length, first + name.length + 130)))
      if (windows.length >= 2) break
    }
    if (windows.length === 0) continue
    const block = `${name}：${windows.join(' … ')}`
    if (used + block.length > maxChars) break
    result.push(block)
    used += block.length
  }
  return result.join('\n')
}
