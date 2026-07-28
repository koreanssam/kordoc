import { describe, it } from "node:test"
import assert from "node:assert/strict"
import JSZip from "jszip"
import { markdownToHwpx, parse } from "../src/index.js"

const EXAM_MD = `---
시험일시: 2026.10.20.(화) 2교시
학교: 영산중학교
학년: 2
과목: 국어
과목코드: 01
시험명: 2026학년도 2학기 1차시험
전체쪽수: 2
전체문항수: 3
만점: 100
서술형점수: 100
---

## [서술형 1] 다음 글을 읽고 물음에 답하시오.

첫 번째 본문 문단입니다.
두 번째 본문 문단입니다.

# 서술형 1-1. 핵심 내용을 쓰시오. (5점)
# 서술형 1-2. 표현상의 특징을 쓰시오. (5점)

## [서술형 2] 다음 자료를 읽고 물음에 답하시오.

자료 본문입니다.

# 서술형 2. 다음은 학생들이 나눈 대화이다.

:::보기
민수: 첫 번째 발언
지수: 두 번째 발언
:::

# 서술형 2-1. 적절한 답을 쓰시오. (10점)
`

const RUBRIC_MD = `---
과목: 국어
학년도: 2026
학기: 2
차수: 1
학년: 2
반영점수: 20
출제자: 홍 길 동 (인)
---

| 문항 | 정답 | 인정정답 및 채점기준 | 배점 |
|---|---|---|---:|
| 1-1 | 핵심 내용 | 의미가 일치하면 5점. | 5 |
| 1-2 | 첫째 기준<br>둘째 기준 | 각 기준을 충족하면 각 5점. | 10 |
| 2-1 | 적절한 답 | 의미가 일치하면 5점. | 5 |
| 합 계 |  |  | 20 |
`

describe("학교 평가 내장 프리셋", () => {
  it("고사원안: 실물 템플릿 스타일로 본문·문항·보기 블록을 동적 생성", async () => {
    const buffer = await markdownToHwpx(EXAM_MD, { gongmun: { preset: "고사원안" } })
    assert.ok(buffer.byteLength > 50_000)

    const zip = await JSZip.loadAsync(buffer)
    const section = await zip.file("Contents/section0.xml")!.async("string")
    const header = await zip.file("Contents/header.xml")!.async("string")
    assert.match(section, /2026\.10\.20\.\(화\) 2교시/)
    assert.match(section, /첫 번째 본문 문단입니다/)
    assert.match(section, /서술형 1-1\./)
    assert.match(section, /민수: 첫 번째 발언/)
    assert.match(header, /spacing hangul="-5"/)
    assert.match(header, /나눔명조/)

    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (result.success) {
      assert.ok(result.markdown.includes("핵심 내용을 쓰시오"))
      assert.ok(result.markdown.includes("적절한 답을 쓰시오"))
      assert.ok(result.markdown.includes("민수: 첫 번째 발언"))
    }
  })

  it("고사원안: Kordoc이 HWP에서 추출한 평문·HTML 표를 그대로 왕복", async () => {
    const extracted = `<table>
<tr><th>2026.4.28.(화) 2교시</th><th>국어<br>( 과목코드: 01)</th><th>영산중학교</th></tr>
<tr><td>( 2 )학년</td><td>2026학년도 1학기 1차시험</td><td>전체쪽수<br>6쪽<br>전체문항수<br>2문항</td></tr>
</table>

※ 만점 20점 : 서술형 (20)점

[서술형 1] 다음 글을 읽고 물음에 답하시오.

첫 번째 본문입니다.

서술형 1-1. 핵심 내용을 쓰시오. (5점)

서술형 2. 다음 <보기>를 읽으시오.

<table>
<tr><th><보기></th></tr>
<tr><td>민수: 첫째 발언<br>지수: 둘째 발언</td></tr>
</table>

서술형 2-1. 관점 차이를 쓰시오. (15점)

\\* 확인 사항`
    const buffer = await markdownToHwpx(extracted, { gongmun: { preset: "고사원안" } })
    const zip = await JSZip.loadAsync(buffer)
    const section = await zip.file("Contents/section0.xml")!.async("string")
    assert.match(section, /2026\.4\.28\.\(화\) 2교시/)
    assert.match(section, /\( 2 \)학년/)
    assert.match(section, /2026학년도 1학기 1차시험/)
    assert.match(section, /첫 번째 본문입니다/)
    assert.match(section, /민수: 첫째 발언/)
    assert.match(section, /관점 차이를 쓰시오/)
    assert.match(section, /colCount="2"/)
  })

  it("서술형문항채점기준표: 행 수를 마크다운 표에 맞춰 증감", async () => {
    const buffer = await markdownToHwpx(RUBRIC_MD, { gongmun: { preset: "서술형문항채점기준표" } })
    const zip = await JSZip.loadAsync(buffer)
    const section = await zip.file("Contents/section0.xml")!.async("string")
    assert.match(section, /\(국어\)과 2026학년도 \( 2 \)학기 \( 1 \)차 시험 \(2\)학년/)
    assert.match(section, /rowCnt="5"/)
    assert.match(section, /홍 길 동 \(인\)/)
    assert.match(section, /둘째 기준/)

    const result = await parse(buffer)
    assert.equal(result.success, true)
    if (result.success) {
      assert.ok(result.markdown.includes("핵심 내용"))
      assert.ok(result.markdown.includes("각 기준을 충족하면 각 5점."))
      assert.ok(result.markdown.includes("합 계"))
    }
  })

  it("서술형문항채점기준표: Kordoc이 HWP에서 추출한 HTML 표를 그대로 왕복", async () => {
    const extracted = `(국어)과 2026학년도 ( 1 )학기 ( 1 )차 시험 (2)학년

정기시험 서술형 문항 채점 기준표

<table>
<tr><td>반영점수 : 8점</td></tr>
<tr><td>출 제 자 : 이 성 원 (인)</td></tr>
</table>

<table>
<tr><th>문항</th><th>정답</th><th>인정정답 및 채점기준</th><th>배점</th></tr>
<tr><td>1-1</td><td>첫째 답<br>둘째 답</td><td>의미가 일치하면 3점.</td><td>3</td></tr>
<tr><td>1-2</td><td>정답</td><td>정확하면 5점.</td><td>5</td></tr>
<tr><td colspan="3">합 계</td><td>8</td></tr>
</table>`
    const buffer = await markdownToHwpx(extracted, { gongmun: { preset: "rubric" } })
    const zip = await JSZip.loadAsync(buffer)
    const section = await zip.file("Contents/section0.xml")!.async("string")
    assert.match(section, /\(국어\)과 2026학년도 \( 1 \)학기 \( 1 \)차 시험 \(2\)학년/)
    assert.match(section, /반영점수 : 8점/)
    assert.match(section, /이 성 원 \(인\)/)
    assert.match(section, /rowCnt="4"/)
    assert.match(section, /첫째 답/)
    assert.match(section, /둘째 답/)
  })

  it("영문 별칭 exam/rubric도 동일한 전용 생성기로 분기", async () => {
    const exam = await markdownToHwpx(EXAM_MD, { gongmun: { preset: "exam" } })
    const rubric = await markdownToHwpx(RUBRIC_MD, { gongmun: { preset: "rubric" } })
    assert.ok(exam.byteLength > 50_000)
    assert.ok(rubric.byteLength > 40_000)
  })
})
