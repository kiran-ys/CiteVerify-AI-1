# CiteVerify reasoning benchmark — 2026-11-19

- Commit: `4d1a0ee` (plus uncommitted changes if any) · Provider: ollama · Model: `llama3.2`
- Cases: 48 (38 real claims, 10 deliberately altered). Evidence snapshot captured 2026-11-19.
- **Label status: 0 human-reviewed, 48 provisional (AI-assisted).** These numbers measure agreement with provisional labels, not scientific accuracy.

## Summary

| Metric | Value |
| --- | --- |
| Overall accuracy | 14/48 (29.2%) |
| Accuracy, clear cases | 8/27 (29.6%) |
| Accuracy, borderline cases | 6/21 (28.6%) |
| Accuracy, real claims | 11/38 (28.9%) |
| Accuracy, altered claims | 3/10 (30.0%) |
| Agreement, human-reviewed labels | 0/0 (n/a) |
| Agreement, evidence: abstract only / full text / none | 12/44 (27.3%) / 0/2 (0.0%) / 2/2 (100.0%) |
| Macro precision / recall / F1 | 0.42 / 0.31 / 0.28 |
| Weighted F1 (by expected-class size) | 0.30 |
| Abstention rate (predicted Unable to verify) | 10.4% |
| Agreement when the model did not abstain | 11/43 (25.6%) |
| Evidence retrieval success (cases with at least one stored passage) | 95.8% |
| Invalid model output rate | 4.3% of model calls |
| API failures / timeouts / rate limits | 0 / 0 / 0 |
| Evidence citation validity (positive verdicts citing only stored source text) | 100.0% of 43 |
| Latency per model-judged claim: mean / p50 / p90 | 10.5 / 9.9 / 12.7 s |

Abstentions count as misses unless the expected label is Unable to verify, so a cautious model scores lower on agreement but makes fewer unsupported calls; read the non-abstained agreement alongside the overall figure.

## Per verdict

| Verdict | Cases | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
| Supported | 16 | 0.67 | 0.13 | 0.21 |
| Partially supported | 16 | 0.32 | 0.44 | 0.37 |
| Contradicted | 5 | 0.11 | 0.40 | 0.17 |
| Unsupported | 0 | 0.00 | 0.00 | 0.00 |
| Unable to verify | 11 | 0.60 | 0.27 | 0.37 |

## Confusion matrix (rows: expected, columns: predicted)

| | Supported | Partially supported | Contradicted | Unsupported | Unable to verify |
| --- | --- | --- | --- | --- | --- |
| **Supported** | 2 | 13 | 1 | 0 | 0 |
| **Partially supported** | 1 | 7 | 7 | 0 | 1 |
| **Contradicted** | 0 | 2 | 2 | 0 | 1 |
| **Unsupported** | 0 | 0 | 0 | 0 | 0 |
| **Unable to verify** | 0 | 0 | 8 | 0 | 3 |

## Misses

- `real/PMC7065031/claim-004` (Partially supported, borderline): expected **Partially supported**, got **Unable to verify** — failure: invalid_output. The model's answer was rejected because the model did not return valid JSON (and again on one retry: the model did not return valid JSON).
- `real/PMC7065031/claim-005` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that vascular endothelial function measured via flow-mediated dilation (FMD) is impaired after menopause, but evidence passage E3 shows no endothelial dysfunction in normally menstruating normotensive women and age-related impairment only afte
- `real/PMC7065031/claim-008` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that aerobic exercise training improves endothelial function in individuals with CVD risk and hypertension, but the evidence passages study patients with type 2 diabetes, which is a different population. The passages do discuss endothelial fun
- `real/PMC7065031/claim-009` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that aerobic exercise improves endothelial function by increasing antegrade vascular shear stress, which leads to upregulation of nitric oxide synthase and greater nitric oxide release. However, the evidence passages do not directly support th
- `real/PMC7065031/claim-023` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that treadmill training did not change FMD, but the evidence passages describe a study on resistance training and brachial artery reactivity in postmenopausal women, which is a different question.
- `real/PMC7065031/claim-024` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that Pierce et al. found no improvement in FMD in postmenopausal women with no CVD, but they found improvement in older men. However, the evidence passages show that regular aerobic exercise improved FMD in both post-menopausal women and older
- `real/PMC7065031/claim-026` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that subject populations with elevated blood pressure have shown improvement in FMD with aerobic exercise training, but the evidence passages do not directly support this finding. However, they do show that physical training improves flow-medi
- `real/PMC7065031/claim-028` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim states that FMD increased after 2 and 4 weeks but was not significantly different from baseline at 6 or 8 weeks. However, the evidence passages show that FMD did increase at 2 and 4 weeks, but returned to baseline levels by week 8. The population stu
- `real/PMC7065031/claim-030` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim states that approximately 70% of exercisers presented with endothelial dysfunction, but the evidence passage E1 only discusses hypertension and does not mention exercise. The finding about endothelial dysfunction is contradicted by the fact that some
- `real/PMC7065031/claim-032` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that there is a consistent improvement in endothelial function in individuals with CVD risk, but inconsistent results in apparently healthy subjects. The evidence passages support the first part of this statement (population and outcome), but 
- `real/PMC7065031/claim-034` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that FMD uncorrected for shear is associated with CVD risk, but the evidence passages only discuss the association between FMD and cardiovascular events in post-menopausal women. While they do report a significant relationship, it's not direct
- `real/ioannidis-2005/claim-001` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim mentions refutation and controversy across various research designs, but the evidence passages discuss genetic association studies and replication validity, which are a different topic. The finding part of the claim is contradicted by E7, which state
- `real/ioannidis-2005/claim-002` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim states that false findings may be the majority or even the vast majority of published research claims, but the evidence passages discuss issues with association study designs and the potential for true heterogeneity in gene-disease associations, whic
- `real/ioannidis-2005/claim-003` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim states that the high rate of nonreplication is a consequence of claiming conclusive research findings solely on the basis of a single study, but the evidence passages discuss the issue of false positives in genetic association studies and the limitat
- `real/ioannidis-2005/claim-004` (Supported, clear): expected **Supported**, got **Partially supported**. The claim mentions the probability of a finding being true, but the passages discuss the probability of false positives and the importance of considering prior probabilities and statistical power. The passages do not directly address the relationship between p
- `real/ioannidis-2005/claim-008` (Unable to verify, borderline): expected **Unable to verify**, got **Contradicted**. The claim's population and intervention are not mentioned in the evidence passages, which focus on validating prognostic models. The finding that the model does not always work well is presented as a general statement about prognostic models, rather than a spe
- `real/ioannidis-2005/claim-009` (Unable to verify, borderline): expected **Unable to verify**, got **Contradicted**. The claim about relative risks for genetic risk factors is contradicted by the evidence, which states that identified genetic associations are probably true. The passage also mentions meta-analysis as a way to separate true from false findings, but does not pr
- `real/ioannidis-2005/claim-010` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim states that fields considered highly informative and creative should have extremely low PPV, but the evidence passages discuss the prognostic value of microarray results in cancer studies with caution, suggesting that they may not be as low as claime
- `real/ioannidis-2005/claim-013` (Unable to verify, clear): expected **Unable to verify**, got **Contradicted**. The claim states that fields using established methods may yield more true findings, but the evidence passages discuss the adoption of new statistical methods and their impact on medical journals, which is a different question. The passage E4 mentions the need
- `real/ioannidis-2005/claim-014` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim states that conflicts of interest are very common in biomedical research, but the evidence passages only discuss reporting of conflicts of interest and do not directly state that conflicts of interest are common. However, they do report that a signif
- `real/ioannidis-2005/claim-015` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim states that expert opinion is extremely unreliable, but the evidence passages discuss the relationship between accumulating data from randomized control trials and recommendations of clinical experts, without directly addressing the reliability of ex
- `real/ioannidis-2005/claim-016` (Supported, clear): expected **Supported**, got **Contradicted**. The claim states that a sequence of extreme opposites is common in molecular genetics, but the evidence passages show that such a sequence was not seen in clinical trials meta-analyses. Instead, retrospective hypothesis-generating research often shows a rapid 
- `real/ioannidis-2005/claim-018` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim states that the population is postmenopausal women, but the evidence passages are about cancer outcomes and gene profiling in general. The finding of a significant association between gene polymorphisms and schizophrenia susceptibility contradicts th
- `real/ioannidis-2005/claim-024` (Unable to verify, borderline): expected **Unable to verify**, got **Contradicted**. The claim is about the risk of finding a statistically significant difference for a trivial effect, but the evidence passages discuss the criticism of P-values without addressing this specific issue. The passage E1 states that P-values are a 'practical success
- `real/ioannidis-2005/claim-027` (Partially supported, borderline): expected **Partially supported**, got **Supported**. The claim about improving understanding of R values is supported by the evidence, but the specific population studied in the evidence passages is not mentioned in the claim. The outcome and intervention are also not specified in the claim.
- `real/ioannidis-2005/claim-028` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim that established 'classics' will fail the test is contradicted by evidence passages stating that contradictions and initially stronger effects are not unusual in highly cited research of clinical interventions and their outcomes. The passages do not 
- `real/ioannidis-2005/claim-029` (Partially supported, clear): expected **Partially supported**, got **Contradicted**. The passages discuss multiple testing corrections and their effects on error rates, but do not address the issue of data dredging or how much it may have influenced a reported research finding. The passages are related to the topic of statistical methods for c
- `altered/01-contradicted-direction` (contradicted-direction, clear): expected **Contradicted**, got **Unable to verify** — failure: invalid_output. The model's answer was rejected because the model did not return valid JSON (and again on one retry: the model did not return valid JSON).
- `altered/04-numerical-error` (numerical-error, clear): expected **Contradicted**, got **Partially supported**. The claim states that conflicts of interest are rare, but the evidence passages show that a significant number of authors have financial interests (E4), and some guidelines report on potential conflicts of interest (E5,E6,E7). However, the exact prevalence is 
- `altered/05-numerical-error` (numerical-error, clear): expected **Contradicted**, got **Partially supported**. The claim states that significant associations are 9.7 times more likely per doubling of sample size, but the evidence passage E3 only mentions a 3.5 times increase and does not mention doubling of sample size. The other passages do not support the finding eit
- `altered/06-miscitation` (miscitation, clear): expected **Unable to verify**, got **Contradicted**. The claim states that a sequence of extreme opposite results is frequent in randomized controlled trials, but the evidence passages show this is not true for clinical trials meta-analyses. Instead, they suggest that rapid early sequences of extreme opposite re
- `altered/07-miscitation` (miscitation, clear): expected **Unable to verify**, got **Contradicted**. The claim mentions a sequence of extreme opposite results in molecular genetics, but the evidence passages discuss the transfer of new statistical methods into medical journals and their appearance in journals, which is not directly related to genetic studies.
- `altered/09-miscitation` (miscitation, clear): expected **Unable to verify**, got **Contradicted**. The claim about true findings being more common with unequivocal outcomes is contradicted by the passage about false positive findings increasing with a large number of statistical tests. The passages discuss methods for estimating the number of true null hypo
- `altered/10-miscitation` (miscitation, clear): expected **Unable to verify**, got **Contradicted**. The claim states that expert opinion is unreliable, but the evidence passages discuss microarray gene-expression profiling and cancer classification, which are unrelated to expert opinions. The passage E3 mentions caution with published microarray results in c
